export interface AuditorReviewUser {
  id: number;
  login: string;
  type?: string;
}

export interface AuditorReview {
  state?: string;
  user?: AuditorReviewUser | null;
}

export interface AuditorApprovalResult {
  approved: boolean;
  reason: string;
}

export function evaluateAuditorApproval(
  reviews: Array<AuditorReview | null | undefined> | null | undefined,
  prAuthorLogin: string,
  auditorLogin: string,
): AuditorApprovalResult;
