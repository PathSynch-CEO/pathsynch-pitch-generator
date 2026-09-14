'use strict';

const {
    loadDirectoryConfiguration, createBookingHostDirectory
} = require('../../services/booking/bookingHostDirectory');

const userId = 'charles_berry_uid';
const workspaceId = 'pathsynch_workspace';
const directoryConfig = Object.freeze({
    userId, workspaceId, routingEligible: true, schedulingEnabled: true
});
const providerConfig = Object.freeze({
    organizerEmail: 'charles@pathsynch.com', timezone: 'America/New_York'
});

function snapshot(data) {
    return { exists: Boolean(data), data: () => data };
}

function dependencies(overrides = {}) {
    const user = overrides.user === undefined ? {
        profile: { displayName: 'Charles Berry', title: 'Founder & CEO', photoURL: 'https://cdn.example.com/charles.png' }
    } : overrides.user;
    const membership = overrides.membership === undefined ? {
        uid: userId, workspaceId, status: 'active'
    } : overrides.membership;
    const authUser = Object.assign({ uid: userId, email: providerConfig.organizerEmail, disabled: false }, overrides.authUser);
    return {
        directoryConfig: overrides.directoryConfig || directoryConfig,
        providerConfig,
        auth: { getUser: jest.fn().mockResolvedValue(authUser) },
        db: {
            collection: jest.fn((name) => ({
                doc: jest.fn((id) => ({
                    get: jest.fn().mockResolvedValue(name === 'users' && id === userId
                        ? snapshot(user)
                        : snapshot(name === 'workspaceMembers' && id === `${workspaceId}_${userId}` ? membership : null))
                }))
            }))
        }
    };
}

describe('server-authoritative booking host directory', () => {
    test('requires explicit routing and scheduling eligibility opt-in', () => {
        const base = {
            SYNCHINTRO_BOOKING_HOST_USER_ID: userId,
            SYNCHINTRO_BOOKING_WORKSPACE_ID: workspaceId
        };
        expect(loadDirectoryConfiguration(base)).toMatchObject({
            routingEligible: false,
            schedulingEnabled: false
        });
        expect(loadDirectoryConfiguration({
            ...base,
            SYNCHINTRO_BOOKING_HOST_ROUTING_ELIGIBLE: 'true',
            SYNCHINTRO_BOOKING_HOST_SCHEDULING_ENABLED: 'true'
        })).toMatchObject({ routingEligible: true, schedulingEnabled: true });
    });

    test('routes every pilot qualification to the canonical Charles Berry user ID', async () => {
        const deps = dependencies();
        const directory = createBookingHostDirectory(deps);
        const routed = await directory.route({
            goal: 'Government opportunity intelligence', category: 'Public Sector', team_size: '2–10'
        });
        expect(routed.routingState).toMatchObject({
            owner_id: userId, workspace_id: workspaceId, route_key: 'public_sector'
        });
        expect(routed.host.specialist).toEqual(expect.objectContaining({
            display_name: 'Charles Berry', title: 'Founder & CEO', initials: 'CB',
            timezone: 'America/New_York'
        }));
        expect(routed.host.specialist.id).toMatch(/^spc_[a-f0-9]{20}$/);
        expect(JSON.stringify(routed.host.specialist)).not.toContain(userId);
    });

    test('uses canonical profile role and photoUrl in the public specialist snapshot', async () => {
        const directory = createBookingHostDirectory(dependencies({
            user: {
                profile: {
                    displayName: 'Charles Berry',
                    role: 'Founder & CEO',
                    title: 'Stale legacy title',
                    photoUrl: 'https://cdn.example.com/charles-canonical.png',
                    photoURL: 'https://cdn.example.com/charles-stale-legacy.png'
                }
            }
        }));

        const routed = await directory.route({});

        expect(routed.host.specialist).toMatchObject({
            title: 'Founder & CEO',
            avatar_url: 'https://cdn.example.com/charles-canonical.png'
        });
    });

    test.each([
        ['disabled auth identity', { authUser: { disabled: true } }],
        ['inactive membership', { membership: { uid: userId, workspaceId, status: 'disabled' } }],
        ['cross-workspace membership', { membership: { uid: userId, workspaceId: 'attacker_workspace', status: 'active' } }],
        ['routing disabled', { directoryConfig: Object.assign({}, directoryConfig, { routingEligible: false }) }],
        ['scheduling disabled', { directoryConfig: Object.assign({}, directoryConfig, { schedulingEnabled: false }) }]
    ])('fails closed for %s', async (_label, change) => {
        await expect(createBookingHostDirectory(dependencies(change)).route({}))
            .rejects.toMatchObject({ code: 'SCHEDULING_PROVIDER_UNAVAILABLE' });
    });

    test('does not use organizer email as routing authority', async () => {
        const deps = dependencies({ authUser: { email: 'different@pathsynch.com' } });
        await expect(createBookingHostDirectory(deps).route({}))
            .rejects.toMatchObject({ code: 'BOOKING_HOST_NOT_CONFIGURED' });
        expect(deps.auth.getUser).toHaveBeenCalledWith(userId);
    });

    test('fails closed when the stable host identity has no organizer mapping email', async () => {
        const deps = dependencies({ authUser: { email: null } });
        await expect(createBookingHostDirectory(deps).route({}))
            .rejects.toMatchObject({ code: 'BOOKING_HOST_NOT_CONFIGURED' });
    });

    test('rejects a provider timezone that conflicts with the fixed Eastern pilot policy', () => {
        expect(() => createBookingHostDirectory(Object.assign({}, dependencies(), {
            providerConfig: Object.assign({}, providerConfig, { timezone: 'America/Los_Angeles' })
        }))).toThrow(expect.objectContaining({ code: 'BOOKING_HOST_NOT_CONFIGURED' }));
    });

    test('rejects a session route that forges another workspace before reading it', async () => {
        const deps = dependencies();
        const directory = createBookingHostDirectory(deps);
        await expect(directory.resolve({ owner_id: userId, workspace_id: 'other_workspace' }))
            .rejects.toMatchObject({ code: 'BOOKING_HOST_NOT_CONFIGURED' });
    });
});
