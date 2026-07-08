import { normalizeContentItems } from '../fileExplorerTree';
import type { ContentItem } from '../../../types/jupyter';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const rawItems = [
  {
    name: 'script.py',
    path: 'script.py',
    type: 'file',
    writable: true,
  },
  {
    name: 'notebooks',
    path: 'notebooks',
    type: 'directory',
    writable: true,
  },
  {
    name: 'analysis.ipynb',
    path: 'analysis.ipynb',
    content_type: 'notebook',
    writable: true,
  },
] as unknown as ContentItem[];

const items = normalizeContentItems(rawItems);

assert(items[0].name === 'notebooks', 'directories sort before files');
assert(
  items[0].content_type === 'directory',
  'Jupyter type is normalized to frontend content_type'
);
assert(items[1].name === 'analysis.ipynb', 'notebooks sort with files by name');
assert(items[1].content_type === 'notebook', 'existing content_type is preserved');
assert(items[2].name === 'script.py', 'files sort by name after directories');
