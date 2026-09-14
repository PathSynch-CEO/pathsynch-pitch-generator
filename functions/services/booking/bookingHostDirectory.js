'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const { resolveBookingOwner, ROUTING_RULE_VERSION } = require('./bookingRouting');
const { loadNylasConfiguration } = require('./nylasSchedulingProvider');
const { DEFAULT_POLICY, normalizePolicy } = require('./bookingSchedulingPolicy');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

function configurationError(message) {
    const error = new Error(message);
    error.code = 'BOOKING_HOST_NOT_CONFIGURED';
    return error;
}

function safeId(value, field) {
    const normalized = String(value || '').trim();
    if (!SAFE_ID.test(normalized)) throw configurationError(`${field} is not configured correctly`);
    return normalized;
}

function safeText(value, field, maximum, required = false) {
    const normalized = String(value || '').trim();
    if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw configurationError(`${field} is not configured correctly`);
    }
    return normalized || null;
}

function safeAvatar(value) {
    if (value === undefined || value === null || value === '') return null;
    try {
        const url = new URL(String(value));
        if (url.protocol !== 'https:') throw new Error('not https');
        return url.toString();
    } catch (_) {
        throw configurationError('booking host avatar is not configured correctly');
    }
}

function initials(displayName) {
    return displayName.split(/\s+/).filter(Boolean).slice(0, 3).map((part) => part[0].toUpperCase()).join('');
}

function publicReference(userId) {
    return `spc_${crypto.createHash('sha256').update(userId).digest('hex').slice(0, 20)}`;
}

function explicitTrue(value) {
    return String(value || '').trim().toLowerCase() === 'true';
}

function loadDirectoryConfiguration(env = process.env) {
    return Object.freeze({
        userId: safeId(env.SYNCHINTRO_BOOKING_HOST_USER_ID, 'booking host user ID'),
        workspaceId: safeId(env.SYNCHINTRO_BOOKING_WORKSPACE_ID, 'booking host workspace ID'),
        routingEligible: explicitTrue(env.SYNCHINTRO_BOOKING_HOST_ROUTING_ELIGIBLE),
        schedulingEnabled: explicitTrue(env.SYNCHINTRO_BOOKING_HOST_SCHEDULING_ENABLED)
    });
}

function createBookingHostDirectory(options = {}) {
    const db = options.db || admin.firestore();
    const auth = options.auth || admin.auth();
    const env = options.env || process.env;
    const directoryConfig = options.directoryConfig || loadDirectoryConfiguration(env);
    const providerConfig = options.providerConfig || loadNylasConfiguration(env);
    const policy = normalizePolicy(options.policy || DEFAULT_POLICY);
    if (providerConfig.timezone !== policy.timezone) {
        throw configurationError('booking provider timezone does not match the SynchIntro scheduling policy');
    }

    async function loadCanonicalHost(expected) {
        const userId = safeId(expected && expected.userId || directoryConfig.userId, 'booking host user ID');
        const workspaceId = safeId(
            expected && expected.workspaceId || directoryConfig.workspaceId,
            'booking host workspace ID'
        );
        if (userId !== directoryConfig.userId || workspaceId !== directoryConfig.workspaceId) {
            throw configurationError('booking host does not match the configured workspace route');
        }
        const [identity, userSnapshot, membershipSnapshot] = await Promise.all([
            auth.getUser(userId),
            db.collection('users').doc(userId).get(),
            db.collection('workspaceMembers').doc(`${workspaceId}_${userId}`).get()
        ]);
        const user = userSnapshot.exists ? userSnapshot.data() : null;
        const membership = membershipSnapshot.exists ? membershipSnapshot.data() : null;
        if (!identity || identity.disabled || !user || !membership
            || membership.uid !== userId || membership.workspaceId !== workspaceId
            || membership.status !== 'active' || directoryConfig.routingEligible !== true
            || directoryConfig.schedulingEnabled !== true) {
            throw new ApiError(
                ErrorCodes.SCHEDULING_PROVIDER_UNAVAILABLE,
                'The configured booking specialist is unavailable'
            );
        }
        const profile = user.profile && typeof user.profile === 'object' ? user.profile : {};
        const displayName = safeText(
            profile.displayName || user.displayName || user.name || identity.displayName
                || membership.displayNameSnapshot || membership.displayName,
            'booking host display name',
            100,
            true
        );
        const title = safeText(
            profile.role || profile.title || profile.jobTitle
                || user.title || user.jobTitle || user.role || 'SynchIntro Specialist',
            'booking host title',
            120,
            true
        );
        const avatarUrl = safeAvatar(
            profile.photoUrl || profile.photoURL || profile.avatarUrl
                || user.photoURL || user.photoUrl || user.avatarUrl || identity.photoURL
        );
        const identityEmail = String(identity.email || '').trim().toLowerCase();
        if (!identityEmail || identityEmail !== providerConfig.organizerEmail) {
            throw configurationError('booking host identity does not match the configured organizer');
        }
        const specialist = Object.freeze({
            id: publicReference(userId),
            display_name: displayName,
            title,
            avatar_url: avatarUrl,
            initials: initials(displayName),
            timezone: policy.timezone
        });
        return Object.freeze({
            id: userId,
            userId,
            workspaceId,
            active: true,
            routingEligible: true,
            schedulingEnabled: true,
            displayName,
            role: title,
            specialist,
            policy,
            providerConfig
        });
    }

    async function route(qualification) {
        const host = await loadCanonicalHost();
        const byRoute = Object.freeze({
            local_growth: host,
            growth_systems: host,
            public_sector: host
        });
        const receipt = resolveBookingOwner({
            qualification,
            qualificationOwners: byRoute,
            fallbackOwner: host
        });
        return Object.freeze({
            host,
            routingState: Object.freeze({
                owner_id: host.userId,
                workspace_id: host.workspaceId,
                source: receipt.source,
                route_key: receipt.routeKey,
                rule_version: receipt.ruleVersion || ROUTING_RULE_VERSION
            })
        });
    }

    async function resolve(routingState) {
        if (!routingState || !routingState.owner_id || !routingState.workspace_id) {
            throw configurationError('booking session has no authoritative host route');
        }
        return loadCanonicalHost({
            userId: routingState.owner_id,
            workspaceId: routingState.workspace_id
        });
    }

    return Object.freeze({ route, resolve });
}

module.exports = { explicitTrue, loadDirectoryConfiguration, createBookingHostDirectory };
