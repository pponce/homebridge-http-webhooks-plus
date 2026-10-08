// Put a short result in the workflow step list as well as the full test log.
// This suite uses only synthetic fixtures, never a live Homebridge config.
const fs = require('node:fs');
module.exports = async function* (events) {
  const failures = [];
  let passed = 0;
  for await (const event of events) {
    if (event.type === 'test:pass') { passed++; yield 'PASS ' + event.data.name + '\n'; }
    if (event.type === 'test:fail') {
      const error = event.data.details.error;
      const detail = error?.cause?.message || error?.message || 'Failed';
      failures.push(detail);
      yield 'FAIL ' + event.data.name + '\n' + String(error?.cause?.stack || error?.stack || detail) + '\n';
    }
    if (event.type === 'test:stdout' || event.type === 'test:stderr') yield event.data.message;
  }
  const result = failures.length ? failures[0].replace(/\s+/g, ' ').slice(0, 600) : passed + ' browser test(s) passed';
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'result=' + result + '\n');
};
