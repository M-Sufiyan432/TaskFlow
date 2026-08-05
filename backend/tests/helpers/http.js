const express = require('express');

const createAuthenticatedApp = (router, user = { _id: '507f1f77bcf86cd799439011', role: 'member' }) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; req.requestId = 'test-request'; next(); });
  app.use(router);
  return app;
};

module.exports = { createAuthenticatedApp };
