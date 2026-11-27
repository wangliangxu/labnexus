import assert from 'node:assert/strict';
import { renderNotebookMarkdown } from '../notebookMarkdown.ts';

const intro = renderNotebookMarkdown('第一版**融合多维空间先验的模型（`SP-Graphormer-Mig v1`）**的完整输入。');
assert.match(intro, /第一版<strong>融合多维空间先验的模型（<code>SP-Graphormer-Mig v1<\/code>）<\/strong>的完整输入/);

const formulas = renderNotebookMarkdown(String.raw`城市集合为$\mathcal{V}$（节点数 $N=367$）。预测 $\hat{\mathbf{Y}}_{t+1:t+H} \in \mathbb{R}_{\ge 0}^{H \times N \times N}$。`);
assert.equal(formulas.match(/class="katex"/g)?.length, 3);
assert.match(formulas, /mathvariant="script">V/);
assert.match(formulas, /<msub>/);
assert.doesNotMatch(formulas, /katex-error|<em>/);

const padded = renderNotebookMarkdown(String.raw`3. 违反 $ \text{SH2O} \le \text{SMC} $、违反 $\text{SMC} \le \text{MAXSMC}$。`);
const legacySource = String.raw`3. 违反 $\text{SH2O} \le \text{SMC} $、违反 $\text{SMC} \le \text{MAXSMC}$。`
  .replaceAll('\\text', '\text');
const legacy = renderNotebookMarkdown(legacySource);
for (const html of [padded, legacy]) {
  assert.equal(html.match(/class="katex"/g)?.length, 2);
  assert.match(html, /<mtext>SH2O<\/mtext><mo>≤<\/mo><mtext>SMC<\/mtext>/);
  assert.match(html, /<mtext>SMC<\/mtext><mo>≤<\/mo><mtext>MAXSMC<\/mtext>/);
  assert.doesNotMatch(html, /katex-error/);
}

const display = renderNotebookMarkdown('推导如下\n$$\nA = \\frac{x_1}{y}\n$$\n因此 $$A y = x_1$$。');
assert.equal(display.match(/class="katex-display"/g)?.length, 2);
assert.match(display, /<mfrac>/);

const literals = renderNotebookMarkdown('`**粗体** $x$`、价格 $5 到 $10、转义 \\$x\\$\n\n```txt\n$y$\n```');
assert.match(literals, /<code>\*\*粗体\*\* \$x\$<\/code>/);
assert.match(literals, /价格 \$5 到 \$10、转义/);
assert.match(literals, /<code class="language-txt">\$y\$/);
assert.doesNotMatch(literals, /class="katex"/);

const invalid = renderNotebookMarkdown(String.raw`$\frac{1$ 后面还有 $x$`);
assert.match(invalid, /katex-error/);
assert.match(invalid, /class="katex"/);
