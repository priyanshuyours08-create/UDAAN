let sqliteWriterQueue = Promise.resolve();
let sqliteWriterTail = sqliteWriterQueue;

async function acquireSqliteWriterLock() {
  const previousPromise = sqliteWriterTail;

  let release;
  const currentPromise = new Promise((resolve) => {
    release = resolve;
  });

  const tailPromise = previousPromise.then(() => currentPromise);
  sqliteWriterTail = tailPromise;

  await previousPromise;

  let released = false;

  return () => {
    if (released) return;
    released = true;
    release();

    if (sqliteWriterTail === tailPromise) {
      sqliteWriterQueue = Promise.resolve();
      sqliteWriterTail = sqliteWriterQueue;
    }
  };
}

/**
 * Protects SQLite from concurrent managed write transactions.
 * Single-process SQLite SIH prototype protection.
 * Production multi-process deployments should use PostgreSQL/MySQL,
 * in which case this queue is bypassed.
 */
async function withSqliteWriteLock(sequelize, transactionCallback) {
  if (sequelize.getDialect() !== 'sqlite') {
    return await transactionCallback();
  }

  const release = await acquireSqliteWriterLock();
  try {
    return await transactionCallback();
  } finally {
    release();
  }
}

module.exports = {
  withSqliteWriteLock,
};
