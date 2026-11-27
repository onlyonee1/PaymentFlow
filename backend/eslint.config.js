'use strict';

const js = require('@eslint/js');
const pluginN = require('eslint-plugin-n');
const pluginJsdoc = require('eslint-plugin-jsdoc');
const globals = require('globals');
const requireMigrationDown = require('./src/utils/eslint-rules/require-migration-down');

module.exports = [
  js.configs.recommended,
  pluginN.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 2021,
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'require-await': 'error',
      'no-console': 'error',
      'n/exports-style': 'off',
      'n/no-extraneous-require': 'off',
      'n/no-process-exit': 'off',
    },
  },
  {
    files: [
      'src/controllers/payment*.js',
      'src/models/payment*.js',
      'src/services/stellarService.js',
      'src/services/transactionPollingService.js',
      'src/services/transactionService.js',
      'src/utils/{money,stellarAmount,stroops,studentBalanceUpdater}.js',
    ],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.name='parseFloat'], CallExpression[callee.property.name='parseFloat']",
        message: 'Use stroop or decimal arithmetic for payment amounts.',
      }],
    },
  },
  {
    files: ['src/utils/logger.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/services/**/*.js', 'src/utils/**/*.js', 'src/middleware/**/*.js'],
    plugins: {
      jsdoc: pluginJsdoc,
    },
    rules: {
      'jsdoc/require-jsdoc': ['error', {
        publicOnly: true,
        require: {
          ArrowFunctionExpression: true,
          FunctionDeclaration: true,
          FunctionExpression: true,
        },
      }],
    },
  },
  // Enforce down() in every migration file — see docs/migrations.md
  {
    files: ['migrations/*.js'],
    plugins: {
      'local-rules': { rules: { 'require-migration-down': requireMigrationDown } },
    },
    rules: {
      'local-rules/require-migration-down': 'error',
    },
  },
];
