import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the real hook's message listener without a browser or Tauri runtime.
const source = readFileSync(new URL('../useKernel.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const listeners = new Map();
const requests = [];
const counts = new Map();
const outputs = [];
const completed = [];
const session = { id: 'session', kernel: { id: 'kernel' } };
const state = [session, 'idle', false, true, null];
let stateIndex = 0;
const react = {
  useState() {
    const index = stateIndex++;
    return [state[index], (value) => { state[index] = value; }];
  },
  useRef: (current) => ({ current }),
  useCallback: (fn) => fn,
  useEffect: (fn) => { fn(); },
};
const dependencies = {
  react,
  '../i18n': { t: (message) => message, localizeStatus: (status) => status },
  '@tauri-apps/api/event': {
    listen: async (name, listener) => {
      listeners.set(name, listener);
      return () => {};
    },
  },
  '../services/tauriIpc': {
    jupyterSendKernelMsg: async (_kernelId, request) => { requests.push(request); },
    subscribeKernelMessages: (kernelId, handler) => {
      listeners.set('kernel:msg', (event) => {
        if (event.payload.kernel_id === kernelId) handler(event.payload);
      });
      return () => {};
    },
  },
};
const exports = {};
new Function('require', 'exports', compiled)((name) => {
  assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
  return dependencies[name];
}, exports);
const kernel = exports.useKernel({
  notebookPath: 'test.ipynb',
  onCellExecutionCount: (cellId, count) => { counts.set(cellId, count); },
  onCellOutput: (cellId, output) => { outputs.push({ cellId, output }); },
  onCellExecutionDone: (cellId, count, hadError) => {
    if (count !== undefined) counts.set(cellId, count);
    completed.push({ cellId, hadError });
  },
});
function emit(request, msgType, content, options = {}) {
  listeners.get('kernel:msg')({
    payload: {
      kernel_id: options.kernelId ?? 'kernel',
      msg: {
        header: { msg_type: msgType },
        parent_header: { msg_id: request.header.msg_id, ...options.parent },
        content,
      },
    },
  });
}

assert.equal(await kernel.executeCell('print-cell', 'print(200)'), true);
const printRequest = requests.at(-1);
emit(printRequest, 'execute_input', { execution_count: 7 });
assert.equal(counts.get('print-cell'), 7, 'input message supplies the execution count');
assert.equal(completed.length, 0, 'receiving a count does not finish execution');
emit(printRequest, 'stream', { name: 'stdout', text: '200\n' });
assert.equal(outputs[0].output.text, '200\n');
emit(printRequest, 'status', { execution_state: 'idle' });
emit(printRequest, 'execute_reply', { status: 'ok', execution_count: 7 });
assert.equal(counts.get('print-cell'), 7, 'count survives idle arriving before shell reply');
assert.equal(completed.length, 1);

await kernel.executeCell('queued-a', 'pass');
const first = requests.at(-1);
await kernel.executeCell('queued-b', 'raise ValueError()');
const second = requests.at(-1);
emit(first, 'execute_input', { execution_count: 8 });
emit(second, 'execute_input', { execution_count: 9 });
assert.equal(counts.get('queued-a'), 8, 'queued counts follow request IDs');
assert.equal(counts.get('queued-b'), 9);
emit(second, 'error', { ename: 'ValueError', evalue: '', traceback: [] });
assert.equal(counts.get('queued-b'), 9, 'failed executions retain their count');
assert.equal(completed.at(-1).hadError, true);

emit(first, 'execute_input', { execution_count: 100 }, { kernelId: 'other-kernel' });
emit(first, 'execute_input', { execution_count: 101 }, {
  parent: { username: 'labnexus_agent' },
});
emit(first, 'execute_input', { execution_count: 102 }, {
  parent: { session: 'agent_session' },
});
emit(first, 'execute_input', { execution_count: null });
assert.equal(counts.get('queued-a'), 8, 'unrelated, agent and invalid counts are ignored');
emit(first, 'execute_input', { execution_count: 0 });
assert.equal(counts.get('queued-a'), 0, 'zero is a valid numeric execution count');
console.log('useKernel execution count regression tests passed');
