export const DASHBOARD_HEADER = 'X-Dashboard-Token';
// Midnight after Wednesday, October 28, 2026 in America/Regina (UTC-6).
export const SINGLE_DASHBOARD_UNTIL = Date.parse('2026-10-29T06:00:00Z');
export const dashboardRestrictionActive = () => Date.now() < SINGLE_DASHBOARD_UNTIL;
