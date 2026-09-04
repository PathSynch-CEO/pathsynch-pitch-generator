'use strict';

const {
    normalizeAttribution,
    validateCreateSession,
    validateSessionUpdate,
    validateBookingRequest,
    normalizeIdempotencyKey,
    bookingRequestFingerprint,
    assessIdempotency
} = require('../../services/booking/bookingContract');
const {
    qualificationRouteKey,
    resolveBookingOwner
} = require('../../services/booking/bookingRouting');
const {
    assertSchedulingProvider,
    createUnconfiguredSchedulingProvider
} = require('../../services/booking/schedulingProvider');

const baseCompany = {
    name: 'PathSynch',
    domain: 'pathsynch.com',
    website: 'https://pathsynch.com',
    description: null,
    description_source: 'not_available',
    confidence: 'medium',
    source: 'identity_domain',
    match_status: 'confirmed',
    verified_at: '2026-09-04T18:00:00.000Z'
};

const baseQualification = {
    goal: 'Generate more qualified leads',
    category: 'Professional Services',
    team_size: '2–10'
};

const baseBooking = {
    session_version: 3,
    slot: {
        id: 'slot_123',
        start: '2026-09-10T14:00:00.000Z',
        end: '2026-09-10T14:30:00.000Z',
        timezone: 'America/New_York',
        availability_version: 2
    },
    guests: ['Guest@Example.com']
};

function owner(id, extra = {}) {
    return Object.assign({ id, displayName: id, active: true, schedulingEnabled: true }, extra);
}

describe('SynchIntro booking production contract', () => {
    describe('session validation', () => {
        test('normalizes identity and allow-listed attribution', () => {
            const result = validateCreateSession({
                flow_id: 'flow_1234567890',
                identity: { email: 'BUYER@EXAMPLE.COM', provider: 'email' },
                timezone: 'America/New_York',
                attribution: {
                    utm_source: 'LinkedIn',
                    utm_id: 'campaign-42',
                    utm_term: 'roofing',
                    campaign_id: 'campaign:fall-2026',
                    email: 'must-not-pass@example.com',
                    unknown: 'discard me'
                }
            });

            expect(result.valid).toBe(true);
            expect(result.value.identity.email).toBe('buyer@example.com');
            expect(result.value.attribution).toEqual({
                utm_source: 'LinkedIn',
                utm_id: 'campaign-42',
                utm_term: 'roofing',
                campaign_id: 'campaign:fall-2026'
            });
        });

        test('drops attribution values that resemble PII', () => {
            expect(normalizeAttribution({
                utm_content: 'buyer@example.com',
                campaign_id: '+1 (404) 555-1212',
                creative_id: 'creative-7'
            })).toEqual({ creative_id: 'creative-7' });
        });

        test('rejects an invalid IANA timezone and unknown request fields', () => {
            const invalidTimezone = validateCreateSession({
                flow_id: 'flow_1234567890',
                identity: { email: 'buyer@example.com', provider: 'email' },
                timezone: 'Mars/Olympus'
            });
            expect(invalidTimezone).toEqual({
                valid: false,
                errors: [{ field: 'timezone', code: 'timezone.invalid' }]
            });

            const unknownField = validateCreateSession({
                flow_id: 'flow_1234567890',
                identity: { email: 'buyer@example.com', provider: 'email' },
                timezone: 'UTC',
                host_id: 'browser-controlled-owner'
            });
            expect(unknownField.valid).toBe(false);
            expect(unknownField.errors).toContainEqual({ field: 'host_id', code: 'object.unknown' });
        });
    });

    describe('company and qualification validation', () => {
        test('accepts a complete normalized qualification and strips the display suffix', () => {
            const result = validateSessionUpdate({
                session_version: 2,
                company: baseCompany,
                qualification: Object.assign({}, baseQualification, { team_size: '11–25 employees' })
            });
            expect(result.valid).toBe(true);
            expect(result.value.qualification.team_size).toBe('11–25');
        });

        test('requires detail only for catch-all answers', () => {
            const missingGoalDetail = validateSessionUpdate({
                session_version: 2,
                company: baseCompany,
                qualification: Object.assign({}, baseQualification, { goal: 'Something else' })
            });
            expect(missingGoalDetail.valid).toBe(false);
            expect(missingGoalDetail.errors).toContainEqual(expect.objectContaining({ field: 'qualification.goal_detail' }));

            const detailed = validateSessionUpdate({
                session_version: 2,
                company: baseCompany,
                qualification: {
                    goal: 'Something else',
                    goal_detail: 'Improve partner conversion',
                    category: 'Other',
                    category_detail: 'Membership association',
                    team_size: '11–25'
                }
            });
            expect(detailed.valid).toBe(true);
        });

        test('rejects an unrecognized company domain', () => {
            const result = validateSessionUpdate({
                session_version: 2,
                company: Object.assign({}, baseCompany, { domain: 'not a domain' }),
                qualification: baseQualification
            });
            expect(result.valid).toBe(false);
            expect(result.errors).toContainEqual(expect.objectContaining({ field: 'company.domain' }));
        });
    });

    describe('booking request validation', () => {
        test('normalizes guest emails and accepts a valid issued slot', () => {
            const result = validateBookingRequest(baseBooking, { prospectEmail: 'buyer@example.com' });
            expect(result.valid).toBe(true);
            expect(result.value.guests).toEqual(['guest@example.com']);
        });

        test('rejects duplicate guests, the prospect, and more than three guests', () => {
            const duplicate = validateBookingRequest(
                Object.assign({}, baseBooking, { guests: ['guest@example.com', 'GUEST@example.com'] })
            );
            expect(duplicate.errors).toEqual([{ field: 'guests', code: 'guests.duplicate' }]);

            const prospect = validateBookingRequest(
                Object.assign({}, baseBooking, { guests: ['buyer@example.com'] }),
                { prospectEmail: 'BUYER@example.com' }
            );
            expect(prospect.errors).toEqual([{ field: 'guests', code: 'guests.includes_prospect' }]);

            const tooMany = validateBookingRequest(Object.assign({}, baseBooking, {
                guests: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']
            }));
            expect(tooMany.valid).toBe(false);
            expect(tooMany.errors).toContainEqual(expect.objectContaining({ field: 'guests' }));
        });

        test('rejects reversed times and invalid timezone', () => {
            const reversed = validateBookingRequest(Object.assign({}, baseBooking, {
                slot: Object.assign({}, baseBooking.slot, { end: '2026-09-10T13:30:00.000Z' })
            }));
            expect(reversed.errors).toEqual([{ field: 'slot.end', code: 'slot.invalid_range' }]);

            const invalidTimezone = validateBookingRequest(Object.assign({}, baseBooking, {
                slot: Object.assign({}, baseBooking.slot, { timezone: 'Local browser time' })
            }));
            expect(invalidTimezone.errors).toEqual([{ field: 'slot.timezone', code: 'timezone.invalid' }]);
        });
    });

    describe('idempotency', () => {
        test('fingerprint is stable across object key order', () => {
            expect(bookingRequestFingerprint({ b: 2, a: { d: 4, c: 3 } }))
                .toBe(bookingRequestFingerprint({ a: { c: 3, d: 4 }, b: 2 }));
        });

        test('distinguishes create, replay, and conflicting reuse', () => {
            const key = 'booking_key_1234567890';
            const fingerprint = bookingRequestFingerprint(baseBooking);
            expect(assessIdempotency(null, key, fingerprint).action).toBe('create');
            expect(assessIdempotency({
                idempotencyKey: key,
                fingerprint,
                booking: { booking_id: 'booking_1' }
            }, key, fingerprint)).toEqual({ action: 'replay', booking: { booking_id: 'booking_1' } });
            expect(assessIdempotency({ idempotencyKey: key, fingerprint: 'different' }, key, fingerprint).action)
                .toBe('conflict');
            expect(assessIdempotency({ idempotencyKey: 'another_booking_key_1', fingerprint }, key, fingerprint).action)
                .toBe('conflict');
            expect(normalizeIdempotencyKey('short')).toBeNull();
        });
    });

    describe('deterministic owner resolution', () => {
        const qualificationOwners = {
            public_sector: owner('maya'),
            growth_systems: owner('jordan'),
            local_growth: owner('alex')
        };

        test('maps the three qualification rule branches', () => {
            expect(qualificationRouteKey({ goal: 'Government opportunity intelligence' })).toBe('public_sector');
            expect(qualificationRouteKey({ goal: 'Automate follow-up' })).toBe('growth_systems');
            expect(qualificationRouteKey({ goal: 'Improve local visibility', team_size: '51+' })).toBe('growth_systems');
            expect(qualificationRouteKey(baseQualification)).toBe('local_growth');
        });

        test('enforces existing, campaign, qualification, round-robin, fallback precedence', () => {
            const all = {
                existingOwner: owner('existing'),
                campaignOwner: owner('campaign'),
                qualification: baseQualification,
                qualificationOwners,
                roundRobinOwner: owner('round-robin'),
                fallbackOwner: owner('fallback')
            };
            expect(resolveBookingOwner(all).source).toBe('existing_attio_owner');
            expect(resolveBookingOwner(Object.assign({}, all, { existingOwner: null })).source).toBe('approved_campaign_owner');
            expect(resolveBookingOwner(Object.assign({}, all, { existingOwner: null, campaignOwner: null })).source).toBe('qualification_rule');
            expect(resolveBookingOwner(Object.assign({}, all, {
                existingOwner: null,
                campaignOwner: null,
                qualificationOwners: {}
            })).source).toBe('round_robin');
            expect(resolveBookingOwner(Object.assign({}, all, {
                existingOwner: null,
                campaignOwner: null,
                qualificationOwners: {},
                roundRobinOwner: null
            })).source).toBe('fallback');
        });

        test('skips disabled owners and fails closed without a fallback', () => {
            const receipt = resolveBookingOwner({
                existingOwner: owner('disabled', { active: false }),
                qualification: baseQualification,
                qualificationOwners
            });
            expect(receipt.owner.id).toBe('alex');
            expect(() => resolveBookingOwner({ qualification: baseQualification }))
                .toThrow(expect.objectContaining({ code: 'BOOKING_OWNER_UNAVAILABLE' }));
        });
    });

    describe('scheduling provider boundary', () => {
        test('fails explicitly while Nylas is not configured', async () => {
            const provider = assertSchedulingProvider(createUnconfiguredSchedulingProvider());
            await expect(provider.getAvailability({})).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
            await expect(provider.createBooking({})).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
        });

        test('rejects an incomplete provider adapter', () => {
            expect(() => assertSchedulingProvider({ getAvailability: async () => [] }))
                .toThrow(expect.objectContaining({ code: 'INVALID_SCHEDULING_PROVIDER' }));
        });
    });
});
