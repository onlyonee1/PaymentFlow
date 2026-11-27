import {
  transformVolumeTrend,
  transformCategorySplit,
  transformClassComparison,
  formatChartCsv,
} from "../chartTransforms";

describe("chartTransforms utilities", () => {
  describe("transformVolumeTrend", () => {
    it("returns empty state structure when data is empty or invalid", () => {
      expect(transformVolumeTrend([])).toEqual(
        expect.objectContaining({ isEmpty: true, items: [] })
      );
      expect(transformVolumeTrend(null)).toEqual(
        expect.objectContaining({ isEmpty: true, items: [] })
      );
    });

    it("calculates xlm and fiat coordinates correctly", () => {
      const mockData = [
        { date: "2026-01-01", totalAmount: 100, paymentCount: 5 },
        { date: "2026-01-02", totalAmount: 200, paymentCount: 10 },
      ];
      const result = transformVolumeTrend(mockData, 0.15, 600, 240, 40);

      expect(result.isEmpty).toBe(false);
      expect(result.items).toHaveLength(2);
      expect(result.maxAmount).toBe(200);
      expect(result.maxFiat).toBe(30); // 200 * 0.15
      expect(result.items[0].fiat).toBe(15);
      expect(result.items[1].fiat).toBe(30);
      expect(result.pointsXlm).toContain(",");
      expect(result.areaXlm).toContain("M");
    });
  });

  describe("transformCategorySplit", () => {
    it("handles empty and zero data gracefully", () => {
      expect(transformCategorySplit([])).toEqual({ items: [], totalAmount: 0, isEmpty: true });
      expect(transformCategorySplit([{ category: "Tuition", totalAmount: 0 }])).toEqual({
        items: [],
        totalAmount: 0,
        isEmpty: true,
      });
    });

    it("computes accurate percentages and SVG donut arc paths", () => {
      const mockCategories = [
        { category: "Tuition", totalAmount: 750, count: 15 },
        { category: "Transport", totalAmount: 250, count: 5 },
      ];
      const result = transformCategorySplit(mockCategories);

      expect(result.isEmpty).toBe(false);
      expect(result.totalAmount).toBe(1000);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].percent).toBe(75);
      expect(result.items[1].percent).toBe(25);
      expect(result.items[0].path).toMatch(/^M /);
      expect(result.items[0].color).toBeDefined();
    });
  });

  describe("transformClassComparison", () => {
    it("handles empty data", () => {
      expect(transformClassComparison([])).toEqual({ items: [], maxVal: 0, isEmpty: true });
    });

    it("normalizes collected and outstanding per grade/class", () => {
      const mockClasses = [
        { class: "Grade 1", totalCollected: 500, totalOutstanding: 100 },
        { class: "Grade 2", totalCollected: 300, totalOutstanding: 300 },
      ];
      const result = transformClassComparison(mockClasses);

      expect(result.isEmpty).toBe(false);
      expect(result.items).toHaveLength(2);
      expect(result.maxVal).toBe(500);
      expect(result.items[0].rate).toBe(83.3);
      expect(result.items[1].rate).toBe(50);
    });
  });

  describe("formatChartCsv", () => {
    it("generates structured CSV with headers and sections", () => {
      const csv = formatChartCsv({
        volumeData: [{ date: "2026-01-01", count: 2, xlm: 100, fiat: 12 }],
        categoryData: [{ category: "Tuition", amount: 100, percent: 100 }],
        classData: [{ className: "Grade 1", collected: 80, outstanding: 20, rate: 80 }],
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        fiatCurrency: "USD",
      });

      expect(csv).toContain("PAYMENTFLOW SCHOOL FINANCE ANALYTICS REPORT");
      expect(csv).toContain("2026-01-01 to 2026-01-31");
      expect(csv).toContain("Tuition");
      expect(csv).toContain("Grade 1");
    });
  });
});
