/**
 * ROI Calculator Tests
 */

const {
  PATHSYNCH_MONTHLY_COST,
  calculatePitchROI,
  calculateNarrativeROI,
  formatCurrency,
  safeNumber
} = require('../../utils/roiCalculator');

describe('ROI Calculator', () => {
  describe('Constants', () => {
    it('should have correct PathSynch monthly cost', () => {
      expect(PATHSYNCH_MONTHLY_COST).toBe(168);
    });
  });

  describe('calculatePitchROI', () => {
    it('should calculate ROI with default values when inputs are empty', () => {
      const result = calculatePitchROI({});

      // Conservative model defaults: 200 customers, $50 avg ticket, 25% new customer repeat rate
      expect(result.monthlyVisits).toBe(200);
      expect(result.avgTicket).toBe(50);
      expect(result.repeatRate).toBe(25); // newCustomerRepeatRate default
      expect(result.monthlyCost).toBe(168);
    });

    it('should calculate ROI with provided values', () => {
      const result = calculatePitchROI({
        monthlyVisits: 1000,
        avgTransaction: 50
      });

      expect(result.monthlyVisits).toBe(1000);
      expect(result.avgTicket).toBe(50);
      // repeatRate is newCustomerRepeatRate (25% default), not input repeatRate
      expect(result.repeatRate).toBe(25);
    });

    it('should calculate improved visits with 20% growth rate', () => {
      const result = calculatePitchROI({ monthlyVisits: 1000 });
      // Default growth rate is 20%, so 1000 + (1000 * 0.20) = 1200
      expect(result.improvedVisits).toBe(1200);
      expect(result.newCustomers).toBe(200);
    });

    it('should use newCustomerRepeatRate for repeat calculations', () => {
      const result = calculatePitchROI({ monthlyVisits: 100 });
      // Default newCustomerRepeatRate is 25%
      expect(result.repeatRate).toBe(25);
      expect(result.improvedRepeat).toBe(25);
    });

    it('should calculate six month revenue using conservative model', () => {
      const result = calculatePitchROI({
        monthlyVisits: 100,
        avgTransaction: 100
      });

      // Conservative model (new customers only):
      // newCustomers = 100 * 0.20 = 20
      // newCustomerRevenue = 20 * 100 = 2000
      // repeatCustomersFromNew = 20 * 0.25 = 5
      // repeatRevenue = 5 * 100 = 500
      // monthlyIncrementalRevenue = 2000 + 500 = 2500
      // sixMonthRevenue = 2500 * 6 = 15000
      expect(result.sixMonthRevenue).toBe(15000);
    });

    it('should calculate ROI percentage correctly', () => {
      const result = calculatePitchROI({
        monthlyVisits: 100,
        avgTransaction: 100,
        repeatRate: 0.5
      });

      // Six month cost: 168 * 6 = 1008
      // Six month revenue: 28500
      // ROI: ((28500 - 1008) / 1008) * 100 = 2727%
      expect(result.roi).toBeGreaterThan(0);
      expect(result.sixMonthCost).toBe(1008);
    });

    it('should handle avgTicket as alias for avgTransaction', () => {
      const result = calculatePitchROI({
        avgTicket: 75
      });
      expect(result.avgTicket).toBe(75);
    });

    it('should handle string inputs', () => {
      const result = calculatePitchROI({
        monthlyVisits: '500',
        avgTransaction: '50'
      });

      expect(result.monthlyVisits).toBe(500);
      expect(result.avgTicket).toBe(50);
      // repeatRate is newCustomerRepeatRate (25% default), not parsed from input
      expect(result.repeatRate).toBe(25);
    });

    it('should include calculation model metadata', () => {
      const result = calculatePitchROI({});
      expect(result.calculationModel).toBe('conservative_new_customers_only');
    });

    it('should calculate growth rate as percentage', () => {
      const result = calculatePitchROI({});
      // Default growth rate is 20%
      expect(result.growthRate).toBe(20);
    });
  });

  describe('calculateNarrativeROI', () => {
    it('should calculate ROI with default values when inputs are empty', () => {
      const result = calculateNarrativeROI({});

      expect(result.current.monthlyRevenue).toBe(500 * 50); // 25000
      expect(result.current.annualRevenue).toBe(500 * 50 * 12); // 300000
      expect(result.current.repeatRate).toBe(0.3);
    });

    it('should calculate projected revenue with improvements', () => {
      const result = calculateNarrativeROI({
        monthlyVisits: 1000,
        avgTransaction: 100,
        repeatRate: 0.4
      });

      // Current monthly: 1000 * 100 = 100000
      // Visibility + conversion increase: 15% + 10% = 25%
      // Projected monthly: 100000 * 1.25 = 125000
      expect(result.current.monthlyRevenue).toBe(100000);
      expect(result.projected.monthlyRevenue).toBe(125000);
    });

    it('should calculate annual improvement', () => {
      const result = calculateNarrativeROI({
        monthlyVisits: 1000,
        avgTransaction: 100,
        repeatRate: 0.5
      });

      expect(result.improvement.annual).toBe(
        result.projected.annualRevenue - result.current.annualRevenue
      );
    });

    it('should calculate improvement percentage', () => {
      const result = calculateNarrativeROI({
        monthlyVisits: 1000,
        avgTransaction: 100
      });

      // 25% improvement from visibility + conversion
      expect(parseFloat(result.improvement.percentage)).toBeCloseTo(25, 0);
    });

    it('should calculate retention increase', () => {
      const result = calculateNarrativeROI({
        repeatRate: 0.5
      });

      // 12% retention increase
      expect(result.projected.repeatRate).toBeCloseTo(0.5 * 1.12, 2);
    });
  });

  describe('formatCurrency', () => {
    it('should format numbers with commas', () => {
      expect(formatCurrency(1000)).toBe('1,000');
      expect(formatCurrency(1000000)).toBe('1,000,000');
    });

    it('should handle decimal numbers (rounds)', () => {
      expect(formatCurrency(1234.56)).toBe('1,235');
    });

    it('should handle zero', () => {
      expect(formatCurrency(0)).toBe('0');
    });

    it('should handle null/undefined as zero', () => {
      expect(formatCurrency(null)).toBe('0');
      expect(formatCurrency(undefined)).toBe('0');
    });

    it('should handle string numbers', () => {
      expect(formatCurrency('5000')).toBe('5,000');
    });
  });

  describe('safeNumber', () => {
    it('should parse valid numbers', () => {
      expect(safeNumber(42)).toBe(42);
      expect(safeNumber('42')).toBe(42);
    });

    it('should return 0 for invalid inputs', () => {
      expect(safeNumber(null)).toBe(0);
      expect(safeNumber(undefined)).toBe(0);
      expect(safeNumber('invalid')).toBe(0);
      expect(safeNumber(NaN)).toBe(0);
    });

    it('should round to specified decimal places', () => {
      expect(safeNumber(3.14159, 2)).toBe('3.14');
      expect(safeNumber(3.14159, 0)).toBe(3);
    });

    it('should round when decimals is 0', () => {
      expect(safeNumber(3.7, 0)).toBe(4);
      expect(safeNumber(3.2, 0)).toBe(3);
    });
  });
});
