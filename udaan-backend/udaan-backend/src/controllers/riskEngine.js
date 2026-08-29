/**
 * Rule-based risk scoring (an ML model can later replace this — same interface).
 *
 * Inputs: the ApprovalRule's hazard_level + whether it requires inspection,
 * plus the applicant's scale (investment/employees).
 *
 * Output: 'low' | 'medium' | 'high', which downstream decides routing:
 *   low    -> auto_approved (self-certification path)
 *   medium -> pending_review (desk scrutiny by an officer)
 *   high   -> pending_inspection (physical/joint inspection required)
 */
function computeRiskLevel(rule, profile) {
  let score = 0;

  if (rule.hazard_level === 'medium') score += 1;
  if (rule.hazard_level === 'high') score += 2;

  if (rule.requires_inspection) score += 2;

  if (profile.investment_amount > 500) score += 1; // large-scale unit, in INR lakhs
  if (profile.employee_count > 100) score += 1;

  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

function routeByRisk(riskLevel) {
  if (riskLevel === 'low') return 'auto_approved';
  if (riskLevel === 'medium') return 'pending_review';
  return 'pending_inspection';
}

module.exports = { computeRiskLevel, routeByRisk };
