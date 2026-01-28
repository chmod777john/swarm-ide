"use client";

import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";

// Create code plugin with dark theme
const code = createCodePlugin({
  themes: ["github-dark", "github-dark"],
});

const plugins = [code, mermaid];

const testMarkdown = `## Test Markdown

This is a **bold** text and *italic* text.

### Code Block
\`\`\`javascript
// 防抖函数 - 优化频繁触发的事件
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
\`\`\`

### Inline Code
Use \`const x = 42\` for variable declarations.

### List
- Item 1
- Item 2
- Item 3

### Table
| Name | Age |
|------|-----|
| Alice | 25 |
| Bob | 30 |
`;

export default function TestPage() {
  return (
    <div style={{ padding: 40, background: "#09090b", minHeight: "100vh", color: "#e4e4e7" }}>
      <h1 style={{ marginBottom: 24 }}>Streamdown Test</h1>
      <div style={{ maxWidth: 800 }}>
        <Streamdown plugins={plugins}>
          {testMarkdown}
        </Streamdown>
      </div>
    </div>
  );
}
