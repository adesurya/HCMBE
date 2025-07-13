// src/config/database.js
const mysql = require('mysql2');
const logger = require('../../scripts/baksrc/utils/logger');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'news_portal',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  charset: 'utf8mb4',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  multipleStatements: true
});

// Promisify for async/await support
const promisePool = pool.promise();

// Test connection
pool.getConnection((err, connection) => {
  if (err) {
    logger.error('Database connection error:', err);
    return;
  }
  logger.info('Database connected successfully');
  connection.release();
});

// Connection error handling
pool.on('error', (err) => {
  logger.error('Database pool error:', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST') {
    logger.info('Attempting to reconnect to database...');
  } else {
    throw err;
  }
});

module.exports = {
  pool,
  promisePool,
  getConnection: pool.getConnection.bind(pool),
  query: promisePool.query.bind(promisePool),
  execute: promisePool.execute.bind(promisePool)
};