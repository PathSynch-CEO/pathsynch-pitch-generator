'use strict';

/**
 * reportFieldResolver.js
 *
 * Shared resolvers for market report field paths.
 * Handles inconsistency between report.data, report.reportData, and top-level report.
 */

function getReportPayload(report) {
  return (report && (report.data || report.reportData)) || report || {};
}

function getBenchmarks(report) {
  const p = getReportPayload(report);
  return p.benchmarks || p.marketBenchmarks || (report && report.marketBenchmarks) || {};
}

function getStrategicMarketThesis(report) {
  const p = getReportPayload(report);
  return p.strategicMarketThesis || (report && report.strategicMarketThesis) || null;
}

function getStrategicRoadmap(report) {
  const p = getReportPayload(report);
  return p.strategicRoadmap || (report && report.strategicRoadmap) || [];
}

function getKpiScorecard(report) {
  const p = getReportPayload(report);
  return p.kpiScorecard || (report && report.kpiScorecard) || [];
}

function getProductRecommendations(report) {
  const p = getReportPayload(report);
  return p.productRecommendations || (report && report.productRecommendations) || [];
}

function getGrowthFactors(report) {
  const p = getReportPayload(report);
  return p.growthFactors || (report && report.growthFactors) || null;
}

function getSafetyContextData(report) {
  const p = getReportPayload(report);
  return p.safetyContext || (report && report.safetyContext) || null;
}

function getQualifiedLeads(report) {
  const p = getReportPayload(report);
  return p.qualifiedLeads || p.leads || (report && report.qualifiedLeads) || [];
}

function getSeoLandscape(report) {
  const p = getReportPayload(report);
  return p.seoLandscape || (report && report.seoLandscape) || {};
}

function getPublicSectorIntelligence(report) {
  var p = getReportPayload(report);
  return (p && p.publicSectorIntelligence) || (report && report.publicSectorIntelligence) || null;
}

function getNonprofitFinancialIntelligence(report) {
  var p = getReportPayload(report);
  return (p && p.nonprofitFinancialIntelligence) || (report && report.nonprofitFinancialIntelligence) || null;
}

module.exports = {
  getReportPayload,
  getBenchmarks,
  getStrategicMarketThesis,
  getStrategicRoadmap,
  getKpiScorecard,
  getProductRecommendations,
  getGrowthFactors,
  getSafetyContextData,
  getQualifiedLeads,
  getSeoLandscape,
  getPublicSectorIntelligence,
  getNonprofitFinancialIntelligence
};
