/**
 * Unit Tests for pitch/htmlBuilder.js
 *
 * Tests HTML utility functions, color manipulation, and component builders.
 */

const {
    adjustColor,
    truncateText,
    CONTENT_LIMITS,
    buildCssVariables,
    buildCtaTrackingScript,
    buildStatBox,
    buildBrandingFooter,
    buildCtaButton,
    escapeHtml
} = require('../api/pitch/htmlBuilder');

describe('pitch/htmlBuilder', () => {
    describe('adjustColor', () => {
        test('lightens color with positive percent', () => {
            // Black (0,0,0) stays black because 0 * 1.5 = 0
            const blackResult = adjustColor('#000000', 50);
            expect(blackResult).toBe('#000000');

            // Mid-gray should get lighter
            const grayResult = adjustColor('#808080', 50);
            expect(grayResult).toBe('#c0c0c0');
        });

        test('darkens color with negative percent', () => {
            const result = adjustColor('#ffffff', -50);
            expect(result).toBe('#808080'); // Should be darker
        });

        test('handles color without hash', () => {
            const result = adjustColor('3A6746', 0);
            expect(result).toBe('#3a6746');
        });

        test('handles color with hash', () => {
            const result = adjustColor('#3A6746', 0);
            expect(result).toBe('#3a6746');
        });

        test('clamps values to valid range', () => {
            // Very high positive should not exceed 255
            const lightResult = adjustColor('#ffffff', 100);
            expect(lightResult).toBe('#ffffff');

            // Very high negative should not go below 0
            const darkResult = adjustColor('#000000', -100);
            expect(darkResult).toBe('#000000');
        });

        test('correctly adjusts mid-range color', () => {
            // 128 + 50% of 128 = 128 + 64 = 192 = c0
            const result = adjustColor('#808080', 50);
            expect(result).toBe('#c0c0c0');
        });
    });

    describe('truncateText', () => {
        test('returns original text if under limit', () => {
            const text = 'Short text';
            const result = truncateText(text, 100);
            expect(result).toBe('Short text');
        });

        test('truncates text over limit', () => {
            const text = 'This is a very long text that should be truncated at some point';
            const result = truncateText(text, 30);
            expect(result.length).toBeLessThanOrEqual(33); // 30 + '...'
            expect(result).toContain('...');
        });

        test('cuts at word boundary when possible', () => {
            const text = 'Hello world this is a test';
            const result = truncateText(text, 15);
            expect(result).toBe('Hello world...');
        });

        test('uses custom suffix', () => {
            const text = 'This is a long text that needs truncation';
            const result = truncateText(text, 20, ' [more]');
            expect(result).toContain('[more]');
        });

        test('handles null input', () => {
            expect(truncateText(null)).toBe('');
        });

        test('handles undefined input', () => {
            expect(truncateText(undefined)).toBe('');
        });

        test('handles non-string input', () => {
            expect(truncateText(123)).toBe(123);
        });

        test('handles empty string', () => {
            expect(truncateText('')).toBe('');
        });
    });

    describe('CONTENT_LIMITS', () => {
        test('has all expected limits', () => {
            expect(CONTENT_LIMITS.uspItem).toBe(80);
            expect(CONTENT_LIMITS.benefitItem).toBe(80);
            expect(CONTENT_LIMITS.productName).toBe(30);
            expect(CONTENT_LIMITS.productDesc).toBe(60);
            expect(CONTENT_LIMITS.slideIntro).toBe(150);
            expect(CONTENT_LIMITS.differentiator).toBe(150);
        });
    });

    describe('buildCssVariables', () => {
        test('returns CSS with default colors when no options', () => {
            const css = buildCssVariables();
            expect(css).toContain('--color-primary: #3A6746');
            expect(css).toContain('--color-accent: #D4A847');
        });

        test('uses custom primary color', () => {
            const css = buildCssVariables({ primaryColor: '#FF0000' });
            expect(css).toContain('--color-primary: #FF0000');
            expect(css).toContain('--color-primary-dark: #FF0000dd');
        });

        test('uses custom accent color', () => {
            const css = buildCssVariables({ accentColor: '#00FF00' });
            expect(css).toContain('--color-accent: #00FF00');
        });

        test('includes all standard variables', () => {
            const css = buildCssVariables();
            expect(css).toContain('--color-secondary');
            expect(css).toContain('--color-bg');
            expect(css).toContain('--color-bg-light');
            expect(css).toContain('--color-text');
            expect(css).toContain('--color-text-light');
            expect(css).toContain('--color-positive');
            expect(css).toContain('--color-neutral');
            expect(css).toContain('--color-negative');
        });
    });

    describe('buildCtaTrackingScript', () => {
        test('includes pitch ID in script', () => {
            const script = buildCtaTrackingScript('test-pitch-123');
            expect(script).toContain("pitchId: 'test-pitch-123'");
        });

        test('includes trackCTA function', () => {
            const script = buildCtaTrackingScript('pitch-id');
            expect(script).toContain('window.trackCTA');
            expect(script).toContain('navigator.sendBeacon');
        });

        test('includes analytics endpoint', () => {
            const script = buildCtaTrackingScript('pitch-id');
            expect(script).toContain('cloudfunctions.net/api/v1/analytics/track');
        });

        test('handles empty pitch ID', () => {
            const script = buildCtaTrackingScript('');
            expect(script).toContain("pitchId: ''");
        });

        test('uses default level', () => {
            const script = buildCtaTrackingScript('pitch-id', 3);
            expect(script).toContain('|| 3');
        });
    });

    describe('buildStatBox', () => {
        test('creates stat box with value and label', () => {
            const html = buildStatBox('42', 'Users');
            expect(html).toContain('class="stat-box"');
            expect(html).toContain('class="value"');
            expect(html).toContain('class="label"');
            expect(html).toContain('42');
            expect(html).toContain('Users');
        });

        test('handles special characters in value', () => {
            const html = buildStatBox('$1,234', 'Revenue');
            expect(html).toContain('$1,234');
        });
    });

    describe('buildBrandingFooter', () => {
        test('returns empty string when branding hidden and no custom text', () => {
            const html = buildBrandingFooter(true, 'Company', '');
            expect(html).toBe('');
        });

        test('includes PathSynch link when branding not hidden', () => {
            const html = buildBrandingFooter(false, 'PathSynch', '');
            expect(html).toContain('Powered by');
            expect(html).toContain('pathsynch.com');
        });

        test('uses custom company name', () => {
            const html = buildBrandingFooter(false, 'Acme Corp', '');
            expect(html).toContain('Acme Corp');
        });

        test('includes custom footer text', () => {
            const html = buildBrandingFooter(true, 'Company', 'Custom footer message');
            expect(html).toContain('Custom footer message');
        });

        test('includes both custom text and branding', () => {
            const html = buildBrandingFooter(false, 'Company', 'Custom text');
            expect(html).toContain('Custom text');
            expect(html).toContain('Powered by');
        });
    });

    describe('buildCtaButton', () => {
        test('creates button with default options', () => {
            const html = buildCtaButton();
            expect(html).toContain('href="#"');
            expect(html).toContain('Get Started');
            expect(html).toContain('data-cta-type="contact"');
        });

        test('uses custom URL and text', () => {
            const html = buildCtaButton({
                url: 'https://example.com',
                text: 'Click Me'
            });
            expect(html).toContain('href="https://example.com"');
            expect(html).toContain('Click Me');
        });

        test('sets target for new tab', () => {
            const html = buildCtaButton({ newTab: true });
            expect(html).toContain('target="_blank"');
        });

        test('sets target for same tab', () => {
            const html = buildCtaButton({ newTab: false });
            expect(html).toContain('target="_self"');
        });

        test('includes tracking attributes', () => {
            const html = buildCtaButton({
                ctaType: 'book_demo',
                pitchLevel: 3,
                segment: 'Automotive'
            });
            expect(html).toContain('data-cta-type="book_demo"');
            expect(html).toContain('data-pitch-level="3"');
            expect(html).toContain('data-segment="Automotive"');
        });

        test('includes onclick handler', () => {
            const html = buildCtaButton();
            expect(html).toContain('onclick="window.trackCTA && trackCTA(this)"');
        });
    });

    describe('escapeHtml', () => {
        test('escapes ampersand', () => {
            expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
        });

        test('escapes less than', () => {
            expect(escapeHtml('a < b')).toBe('a &lt; b');
        });

        test('escapes greater than', () => {
            expect(escapeHtml('a > b')).toBe('a &gt; b');
        });

        test('escapes double quotes', () => {
            expect(escapeHtml('Say "hello"')).toBe('Say &quot;hello&quot;');
        });

        test('escapes single quotes', () => {
            expect(escapeHtml("It's fine")).toBe("It&#039;s fine");
        });

        test('handles null input', () => {
            expect(escapeHtml(null)).toBe('');
        });

        test('handles undefined input', () => {
            expect(escapeHtml(undefined)).toBe('');
        });

        test('handles non-string input', () => {
            expect(escapeHtml(123)).toBe(123);
        });

        test('escapes multiple special characters', () => {
            expect(escapeHtml('<script>alert("XSS")</script>'))
                .toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
        });
    });
});
