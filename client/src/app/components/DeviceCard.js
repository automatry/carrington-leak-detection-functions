// components/DeviceCard.js
import Link from 'next/link';
import styles from './DeviceCard.module.css';
import { useMemo } from 'react';

// Helper function to get status class
const getStatusClass = (status) => {
  const statusLower = status?.toLowerCase() || 'unknown';
  switch (statusLower) {
    case 'active': return styles.statusActive;
    case 'inactive': return styles.statusInactive;
    case 'online': return styles.statusOnline;
    case 'offline': return styles.statusOffline;
    case 'online_read_error': return styles.statusReadError;
    case 'not_configured': return styles.statusNotConfigured;
    case 'not_commissioned': return styles.statusNotCommissioned;
    default: return styles.statusUnknown;
  }
};

export default function DeviceCard({ device }) {
  const { id, identity, state, config } = device;

  // Extract relevant data safely
  const apartment = identity?.APARTMENT || 'Unassigned';
  const project = identity?.PROJECT || 'Unassigned';
  const commissioned = identity?.commissioned ?? false; // Default to false if undefined
  const leakStatus = state?.leak_status || 'unknown';
  const connectivityStatus = state?.connectivity_status || 'unknown';
  const lastUpdate = state?.lastUpdate; // Firestore Timestamp object
  const serviceStatus = state?.service_status || 'unknown';
  const socketStatus = state?.socket_status || 'unknown';
  const deviceIP = state?.network?.deviceIP || 'N/A';
  const points = config?.bacnet?.read_points || [];
  const primarySensor = points.find(p => p.is_primary_leak_sensor === true);
  const primarySensorDetails = state?.primary_leak_sensor_details;

  const lastUpdateString = useMemo(() => {
    if (!lastUpdate) return 'N/A';
    // Convert Firestore Timestamp to JS Date
    const date = lastUpdate.toDate ? lastUpdate.toDate() : new Date(lastUpdate.seconds * 1000);
    return date.toLocaleString();
  }, [lastUpdate]);

  const connectivityClass = getStatusClass(connectivityStatus);
  const leakClass = getStatusClass(leakStatus);
  const commissionedClass = commissioned ? styles.statusActive : styles.statusNotCommissioned;
  const serviceClass = getStatusClass(serviceStatus);
  const socketClass = getStatusClass(socketStatus);

  return (
    <Link href={`/devices/${id}`} className={styles.cardLink}> {/* Link the whole card */}
        <div className={styles.card}>
            <div className={styles.header}>
                <h3>{apartment}</h3>
                <span className={`${styles.statusBadge} ${commissionedClass}`}>
                    {commissioned ? 'Commissioned' : 'Not Commissioned'}
                </span>
            </div>
            <p className={styles.project}>Project: {project}</p>

            <div className={styles.infoGrid}>
                 <div className={styles.infoItem}>
                    <span className={styles.label}>Connectivity:</span>
                    <span className={`${styles.value} ${connectivityClass}`}>{connectivityStatus}</span>
                </div>
                 <div className={styles.infoItem}>
                    <span className={styles.label}>Leak Status:</span>
                    <span className={`${styles.value} ${leakClass}`}>{leakStatus}</span>
                </div>
                 <div className={styles.infoItem}>
                    <span className={styles.label}>Service:</span>
                    <span className={`${styles.value} ${serviceClass}`}>{serviceStatus}</span>
                </div>
                 <div className={styles.infoItem}>
                    <span className={styles.label}>Socket:</span>
                    <span className={`${styles.value} ${socketClass}`}>{socketStatus}</span>
                </div>
                 <div className={styles.infoItem}>
                    <span className={styles.label}>IP Address:</span>
                    <span className={styles.value}>{deviceIP}</span>
                </div>
                 <div className={styles.infoItem}>
                    <span className={styles.label}>Last Update:</span>
                    <span className={styles.value}>{lastUpdateString}</span>
                </div>
            </div>

            {primarySensor && (
                <div className={styles.primarySensorInfo}>
                    <span className={styles.label}>Primary Sensor ({primarySensor.id}):</span>
                    <span>
                        {primarySensor.object_type} / {primarySensor.object_instance}
                        {primarySensorDetails?.current_value && ` (${primarySensorDetails.current_value})`}
                    </span>
                </div>
            )}
            {/* Maybe add a count of read points? */}
             <div className={styles.pointCount}>
                {points.length} Read Point(s) Configured
             </div>
        </div>
    </Link>
  );
}