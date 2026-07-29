'use strict';

const { acquireAppDataLock } = require('../src/appDataLock');

const appDataLock = acquireAppDataLock(process.argv[2]);
process.stdout.write('locked\n');
setInterval(() => appDataLock.lockPath, 1_000);
