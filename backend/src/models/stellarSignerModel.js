'use strict';

const mongoose = require('mongoose');

const signer = new mongoose.Schema({
  publicKey: { type: String, required: true },
  encryptedSecret: { type: String, required: true },
}, { _id: false });

const state = new mongoose.Schema({
  _id: String,
  active: { type: signer, required: true },
  pending: { type: signer, default: undefined },
  retiringPublicKey: String,
  retireAt: Date,
  envelope: String,
  envelopeExpiresAt: Date,
  initiatedBy: String,
}, { timestamps: true });

module.exports = mongoose.model('StellarSigner', state);
