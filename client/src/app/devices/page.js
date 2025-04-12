// app/devices/page.js
import AuthGuard from "@/app/components/AuthGuard"; // Adjust path
import DeviceList from "@/app/components/DeviceList"; // Adjust path
import styles from "@/app/styles/Page.module.css"; // Create this file

export default function DevicesPage() {
  return (
    <AuthGuard> {/* Protect this page */}
      <div className={styles.container}>
        <h1>Devices</h1>
        <p>Overview of connected BACnet devices.</p>
        <DeviceList />
      </div>
    </AuthGuard>
  );
}