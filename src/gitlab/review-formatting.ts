import type { ReviewFinding } from "../review/report.js";

export function formatReviewFindingSeverity(
  severity: ReviewFinding["severity"],
): string {
  const labels: Record<ReviewFinding["severity"], string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
  };

  return labels[severity];
}
