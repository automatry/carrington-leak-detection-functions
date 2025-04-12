// app/notifications/page.js
import AuthGuard from "@/app/components/AuthGuard";
import NotificationList from "@/app/components/NotificationList"; // Adjust path
import styles from "@/app/styles/Page.module.css";

export default function NotificationsPage() {
  return (
    <AuthGuard>
      <div className={styles.container}>
        <h1>Notifications</h1>
        <p>Recent system events and alerts.</p>
        <NotificationList />
      </div>
    </AuthGuard>
  );
}