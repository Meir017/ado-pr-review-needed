export interface NotificationFilter {
  sections?: ("approved" | "needingReview" | "waitingOnAuthor")[];
  minStalenessLevel?: string;
}

export interface TeamsNotificationConfig {
  webhookUrl: string;
  filters?: NotificationFilter;
}

export interface NotificationsConfig {
  teams?: TeamsNotificationConfig;
}
