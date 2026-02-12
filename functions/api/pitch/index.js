/**
 * Pitch Generator Module - Entry Point
 *
 * This module re-exports all functionality from pitchGenerator.js for backwards compatibility.
 * As refactoring progresses, each component will be extracted into its own file in this directory.
 *
 * Refactoring Plan: See /REFACTORING_PLAN.md
 *
 * Current Status: Step 1 - Backwards-compatible wrapper
 *
 * Future structure:
 * - index.js (this file) - API handlers
 * - validators.js - Pitch limits, auth
 * - dataEnricher.js - Seller context, pre-call forms
 * - htmlBuilder.js - Shared HTML utilities
 * - level1Generator.js - Outreach Sequences
 * - level2Generator.js - One-Pager
 * - level3Generator.js - Enterprise Deck
 */

// Re-export everything from the original pitchGenerator.js
// This maintains backwards compatibility during the refactoring process
module.exports = require('../pitchGenerator');
