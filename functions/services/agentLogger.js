/**
 * Agent Logger Service
 * Logs AI Research Agent executions to Firestore for monitoring and cost tracking
 *
 * Collection: agentLogs
 * Document structure:
 * {
 *   userId: string,
 *   prospectName: string,
 *   companyName: string,
 *   briefId: string | null,
 *   agentType: string,           // "contactEnricher", "newsIntelligence", "linkedinResearch"
 *   agentVersion: string,        // e.g., "1.0-scraper" or "2.0-vertex"
 *   status: string,              // "success", "partial", "failed"
 *   startedAt: timestamp,
 *   completedAt: timestamp,
 *   durationMs: number,
 *   apiCalls: [{
 *     service: string,           // "web-scraper", "newsdata", "google-search", "gemini"
 *     endpoint: string,
 *     statusCode: number,
 *     durationMs: number,
 *     tokensUsed: number | null,
 *     cost: number | null
 *   }],
 *   dataPoints: number,
 *   errorMessage: string | null,
 *   totalCost: number,
 *   createdAt: timestamp
 * }
 */

const admin = require('firebase-admin');

// Cost estimates per service
const COST_PER_CALL = {
    'web-scraper': 0,          // Free (self-hosted)
    'newsdata': 0,             // Free tier (200/day)
    'google-search': 0,        // Free tier (100/day)
    'gemini': 0.00025          // ~$0.00025 per 1K tokens (estimate)
};

const TOKENS_TO_COST = 0.00025 / 1000; // Gemini cost per token

class AgentLogger {
    constructor() {
        this.db = admin.firestore();
        this.currentExecution = null;
    }

    /**
     * Start logging a new agent execution
     * @param {Object} params - Execution parameters
     * @returns {string} Execution ID for tracking
     */
    startExecution({ userId, prospectName, companyName, briefId, agentType, agentVersion = '1.0-scraper' }) {
        this.currentExecution = {
            userId,
            prospectName,
            companyName,
            briefId: briefId || null,
            agentType,
            agentVersion,
            status: 'pending',
            startedAt: new Date(),
            completedAt: null,
            durationMs: 0,
            apiCalls: [],
            dataPoints: 0,
            errorMessage: null,
            totalCost: 0
        };

        return this.currentExecution;
    }

    /**
     * Log an API call during execution
     * @param {Object} call - API call details
     */
    logApiCall({ service, endpoint, statusCode, durationMs, tokensUsed = null }) {
        if (!this.currentExecution) {
            console.warn('AgentLogger: No active execution to log API call');
            return;
        }

        // Calculate cost
        let cost = COST_PER_CALL[service] || 0;
        if (service === 'gemini' && tokensUsed) {
            cost = tokensUsed * TOKENS_TO_COST;
        }

        const apiCall = {
            service,
            endpoint: endpoint?.substring(0, 200) || '', // Truncate long URLs
            statusCode,
            durationMs,
            tokensUsed,
            cost
        };

        this.currentExecution.apiCalls.push(apiCall);
        this.currentExecution.totalCost += cost;
    }

    /**
     * Complete the execution and write to Firestore
     * @param {Object} result - Execution result
     * @returns {Promise<string>} Document ID
     */
    async completeExecution({ status = 'success', dataPoints = 0, errorMessage = null }) {
        if (!this.currentExecution) {
            console.warn('AgentLogger: No active execution to complete');
            return null;
        }

        const completedAt = new Date();
        this.currentExecution.completedAt = completedAt;
        this.currentExecution.durationMs = completedAt - this.currentExecution.startedAt;
        this.currentExecution.status = status;
        this.currentExecution.dataPoints = dataPoints;
        this.currentExecution.errorMessage = errorMessage;

        // Write to Firestore
        try {
            const docRef = await this.db.collection('agentLogs').add({
                ...this.currentExecution,
                startedAt: admin.firestore.Timestamp.fromDate(this.currentExecution.startedAt),
                completedAt: admin.firestore.Timestamp.fromDate(completedAt),
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            const executionId = docRef.id;
            this.currentExecution = null;
            return executionId;
        } catch (error) {
            console.error('AgentLogger: Failed to write log:', error);
            this.currentExecution = null;
            return null;
        }
    }

    /**
     * Get agent statistics for a time period
     * @param {string} period - 'day', 'week', or 'month'
     * @returns {Promise<Object>} Statistics
     */
    async getStats(period = 'week') {
        const now = new Date();
        let startDate;

        switch (period) {
            case 'day':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
            default:
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
        }

        const snapshot = await this.db.collection('agentLogs')
            .where('startedAt', '>=', startDate)
            .get();

        const logs = snapshot.docs.map(doc => doc.data());

        const stats = {
            totalExecutions: logs.length,
            successCount: logs.filter(l => l.status === 'success').length,
            partialCount: logs.filter(l => l.status === 'partial').length,
            failedCount: logs.filter(l => l.status === 'failed').length,
            totalCost: logs.reduce((sum, l) => sum + (l.totalCost || 0), 0),
            avgDuration: logs.length > 0 ? logs.reduce((sum, l) => sum + (l.durationMs || 0), 0) / logs.length : 0,
            totalDataPoints: logs.reduce((sum, l) => sum + (l.dataPoints || 0), 0)
        };

        stats.successRate = stats.totalExecutions > 0 ? (stats.successCount / stats.totalExecutions) * 100 : 0;

        // Group by agent type
        stats.byAgentType = {};
        logs.forEach(log => {
            const type = log.agentType || 'unknown';
            if (!stats.byAgentType[type]) {
                stats.byAgentType[type] = { count: 0, cost: 0 };
            }
            stats.byAgentType[type].count++;
            stats.byAgentType[type].cost += log.totalCost || 0;
        });

        // Group by service
        stats.byService = {};
        logs.forEach(log => {
            (log.apiCalls || []).forEach(call => {
                const service = call.service || 'unknown';
                if (!stats.byService[service]) {
                    stats.byService[service] = { calls: 0, cost: 0 };
                }
                stats.byService[service].calls++;
                stats.byService[service].cost += call.cost || 0;
            });
        });

        return stats;
    }

    /**
     * Get agent health status
     * @returns {Promise<Object>} Health status per agent type
     */
    async getHealth() {
        const agentTypes = ['contactEnricher', 'newsIntelligence', 'linkedinResearch'];
        const health = {};

        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        for (const agentType of agentTypes) {
            const snapshot = await this.db.collection('agentLogs')
                .where('agentType', '==', agentType)
                .where('startedAt', '>=', twentyFourHoursAgo)
                .orderBy('startedAt', 'desc')
                .limit(100)
                .get();

            const logs = snapshot.docs.map(doc => ({
                ...doc.data(),
                startedAt: doc.data().startedAt?.toDate?.()
            }));

            if (logs.length === 0) {
                health[agentType] = {
                    status: 'not_deployed',
                    message: 'No executions in last 24 hours'
                };
                continue;
            }

            const successCount = logs.filter(l => l.status === 'success').length;
            const successRate = (successCount / logs.length) * 100;
            const lastSuccess = logs.find(l => l.status === 'success')?.startedAt;
            const minutesSinceLastSuccess = lastSuccess ? Math.floor((now - lastSuccess) / 60000) : null;

            let status;
            if (successRate >= 90 && minutesSinceLastSuccess < 60) {
                status = 'healthy';
            } else if (successRate >= 70 || minutesSinceLastSuccess < 360) {
                status = 'degraded';
            } else {
                status = 'down';
            }

            health[agentType] = {
                status,
                totalExecutions24h: logs.length,
                successCount24h: successCount,
                successRate24h: Math.round(successRate * 10) / 10,
                lastSuccess,
                minutesSinceLastSuccess
            };
        }

        return health;
    }
}

// Export singleton instance
module.exports = new AgentLogger();
