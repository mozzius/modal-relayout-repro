/**
 * Repro: every commit that touches anything inside a <Modal> re-runs Yoga
 * layout (and pixel-grid rounding) over the *whole* surface, even when the
 * commit changes nothing layout-related.
 *
 * ModalHostViewComponentDescriptor::adopt() calls
 * YogaLayoutableShadowNode::setSize() and setPositionType() on every clone of
 * the ModalHostView, and both unconditionally mark the Yoga node dirty. A
 * commit clones the path from the changed node to the root, so any update
 * under the Modal dirties the root.
 *
 * The app measures the same non-layout update (a background color change,
 * once per frame) in two places:
 *   - "Run outside Modal": the ticker sits in the main screen
 *   - "Run inside Modal": the ticker sits inside a <Modal>
 * The main screen also renders ROW_COUNT rows, so a full re-layout is
 * expensive enough to show up.
 *
 * Each sample is the time from the ticker's render to its useLayoutEffect.
 * With the Fabric renderer that span includes React's commit and the
 * ShadowTree commit (clone + layout + mount) on the JS thread.
 *
 * @format
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';

/** Rows in the main screen. Layout cost scales with this. */
const ROW_COUNT = 1000;
/** Color updates per run. */
const FRAME_COUNT = 120;
const COLORS = ['#f4cccc', '#d9ead3', '#cfe2f3', '#fff2cc'];

type Result = { median: number; p90: number; samples: number };

function summarize(samples: number[]): Result {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: at(0.5), p90: at(0.9), samples: sorted.length };
}

function formatResult(result: Result | undefined) {
  if (!result) {
    return '-';
  }
  return `median ${result.median.toFixed(2)} ms, p90 ${result.p90.toFixed(
    2,
  )} ms (n=${result.samples})`;
}

/**
 * Changes its own background color once per frame, FRAME_COUNT times, and
 * reports how long each render took to reach useLayoutEffect.
 */
function ColorTicker({ onDone }: { onDone: (result: Result) => void }) {
  const [frame, setFrame] = useState(0);
  const renderStart = useRef(0);
  const samples = useRef<number[]>([]);

  renderStart.current = performance.now();

  useLayoutEffect(() => {
    if (frame > 0) {
      samples.current.push(performance.now() - renderStart.current);
    }
  }, [frame]);

  useEffect(() => {
    if (frame >= FRAME_COUNT) {
      onDone(summarize(samples.current));
      return;
    }
    const id = requestAnimationFrame(() => setFrame(value => value + 1));
    return () => cancelAnimationFrame(id);
  }, [frame, onDone]);

  return (
    <View
      style={[
        styles.ticker,
        { backgroundColor: COLORS[frame % COLORS.length] },
      ]}
    />
  );
}

function Rows() {
  return (
    <>
      {Array.from({ length: ROW_COUNT }, (_, index) => (
        <View key={index} style={styles.row}>
          <View style={styles.avatar} />
          <View style={styles.rowText}>
            <Text>Row {index}</Text>
            <Text style={styles.subtitle}>Some secondary text</Text>
          </View>
        </View>
      ))}
    </>
  );
}

function App() {
  const [run, setRun] = useState<'outside' | 'inside' | null>(null);
  const [outside, setOutside] = useState<Result>();
  const [inside, setInside] = useState<Result>();

  const onOutsideDone = (result: Result) => {
    setOutside(result);
    setRun(null);
  };
  const onInsideDone = (result: Result) => {
    setInside(result);
    setRun(null);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <View style={styles.controls}>
          <Button
            title="Run outside Modal"
            disabled={run !== null}
            onPress={() => setRun('outside')}
          />
          <Button
            title="Run inside Modal"
            disabled={run !== null}
            onPress={() => setRun('inside')}
          />
          <Text testID="outside-result">
            Outside Modal: {formatResult(outside)}
          </Text>
          <Text testID="inside-result">
            Inside Modal: {formatResult(inside)}
          </Text>
          {run === 'outside' && <ColorTicker onDone={onOutsideDone} />}
        </View>
        <ScrollView style={styles.list}>
          <Rows />
        </ScrollView>
        <Modal
          visible={run === 'inside'}
          transparent
          animationType="none"
          onRequestClose={() => {}}
        >
          <View style={styles.modal}>
            <Text>Running inside Modal…</Text>
            {run === 'inside' && <ColorTicker onDone={onInsideDone} />}
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  controls: { gap: 8, padding: 16 },
  ticker: { height: 40 },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
  },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#ddd' },
  rowText: { flex: 1 },
  subtitle: { color: '#888' },
  modal: {
    marginTop: 200,
    marginHorizontal: 32,
    padding: 16,
    gap: 8,
    borderRadius: 12,
    backgroundColor: 'white',
  },
});

export default App;
