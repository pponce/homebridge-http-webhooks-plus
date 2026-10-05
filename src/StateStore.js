'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {StateError} = require('./StateContract');

// A single atomic snapshot replaces multi-key writes for these two families.
// Legacy node-persist keys are imported once and retained for backed-up downgrade.
class StateStore {
  constructor(directory, type, id) {
    // Keep a sibling directory: node-persist owns/scans its original directory.
    this.directory = path.resolve(directory) + '.plus-state-v1';
    this.file = path.join(this.directory, crypto.createHash('sha256').update(type + ':' + id).digest('hex') + '.json');
  }
  read() {
    try {
      const info = fs.lstatSync(this.file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw new Error();
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new StateError('state_storage_unavailable', 503);
    }
  }
  write(snapshot) {
    const temporary = this.file + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
    let fd;
    try {
      fs.mkdirSync(this.directory, {recursive: true});
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(snapshot) + '\n');
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, this.file);
      fd = fs.openSync(this.directory, 'r'); fs.fsyncSync(fd);
    } catch (_) {
      // A failure after rename is ambiguous: callers must fail closed, not claim
      // rollback. A restart revalidates the complete old OR new snapshot.
      throw new StateError('state_storage_unavailable', 503);
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* already failed */ }
      try { fs.unlinkSync(temporary); } catch (_) { /* renamed or never created */ }
    }
  }
}
module.exports = StateStore;
