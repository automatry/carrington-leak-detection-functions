// src/app/components/DeviceDetailView.js
import styles from './DeviceDetailView.module.css'; // Create this CSS module
import { useMemo } from 'react';

// Reusable status class helper (could be moved to utils)
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

export default function DeviceDetailView({ device }) {
    const { id, identity, state, config } = device;

    // Extract data safely
    const apartment = identity?.APARTMENT || 'N/A';
    const project = identity?.PROJECT || 'N/A';
    const commissioned = identity?.commissioned ?? false;
    const leakStatus = state?.leak_status || 'unknown';
    const connectivityStatus = state?.connectivity_status || 'unknown';
    const lastUpdate = state?.lastUpdate;
    const serviceStatus = state?.service_status || 'unknown';
    const socketStatus = state?.socket_status || 'unknown';
    const deviceIP = state?.network?.deviceIP || 'N/A';
    const points = config?.bacnet?.read_points || [];
    const primarySensorDetails = state?.primary_leak_sensor_details;
    const discoveredDevices = state?.discovered_bacnet_devices || {};
    const reachability = state?.bacnet_device_reachability || {};
    const firstSeen = state?.firstSeen;

    // Format timestamps
    const lastUpdateString = useMemo(() => lastUpdate?.toDate ? lastUpdate.toDate().toLocaleString() : 'N/A', [lastUpdate]);
    const firstSeenString = useMemo(() => firstSeen?.toDate ? firstSeen.toDate().toLocaleString() : 'N/A', [firstSeen]);

    // Get Status Classes
    const connectivityClass = getStatusClass(connectivityStatus);
    const leakClass = getStatusClass(leakStatus);
    const commissionedClass = commissioned ? styles.statusActive : styles.statusNotCommissioned;
    const serviceClass = getStatusClass(serviceStatus);
    const socketClass = getStatusClass(socketStatus);

    return (
        <div className={styles.container}>
            <h2>{apartment} ({id})</h2>
            <p className={styles.project}>Project: {project}</p>

            <div className={styles.section}>
                <h3>Identity & Status</h3>
                <div className={styles.grid}>
                    <div className={styles.item}><span className={styles.label}>UUID:</span> <span>{id}</span></div>
                    <div className={styles.item}><span className={styles.label}>Commissioned:</span> <span className={commissionedClass}>{commissioned ? 'Yes' : 'No'}</span></div>
                    <div className={styles.item}><span className={styles.label}>Connectivity:</span> <span className={connectivityClass}>{connectivityStatus}</span></div>
                    <div className={styles.item}><span className={styles.label}>Leak Status:</span> <span className={leakClass}>{leakStatus}</span></div>
                    <div className={styles.item}><span className={styles.label}>Service Status:</span> <span className={serviceClass}>{serviceStatus}</span></div>
                    <div className={styles.item}><span className={styles.label}>Socket Status:</span> <span className={socketClass}>{socketStatus}</span></div>
                    <div className={styles.item}><span className={styles.label}>Device IP:</span> <span>{deviceIP}</span></div>
                    <div className={styles.item}><span className={styles.label}>First Seen:</span> <span>{firstSeenString}</span></div>
                    <div className={styles.item}><span className={styles.label}>Last Update:</span> <span>{lastUpdateString}</span></div>
                </div>
            </div>

            {primarySensorDetails && (
                <div className={styles.section}>
                    <h3>Primary Leak Sensor Details</h3>
                    <pre className={styles.preFormatted}>{JSON.stringify(primarySensorDetails, null, 2)}</pre>
                </div>
            )}

             <div className={styles.section}>
                 <h3>Configured Read Points ({points.length})</h3>
                 {points.length > 0 ? (
                     points.map((point, index) => (
                         <div key={point.id || index} className={styles.pointItem}>
                             <strong>{point.id}</strong> ({point.object_type}/{point.object_instance}) Target: {point.target_device_instance}
                             {point.is_primary_leak_sensor && <span className={styles.primaryBadge}>Primary</span>}
                             {point.invert_polarity && <span className={styles.polarityBadge}>Inverted</span>}
                         </div>
                     ))
                 ) : <p>No read points configured.</p>}
             </div>

            <div className={styles.section}>
                <h3>Live Point States</h3>
                {Object.keys(state?.read_point_states || {}).length > 0 ? (
                    <pre className={styles.preFormatted}>{JSON.stringify(state.read_point_states, null, 2)}</pre>
                ) : <p>No live point states available.</p>}
            </div>

             <div className={styles.section}>
                <h3>Discovered BACnet Devices</h3>
                 {Object.keys(discoveredDevices).length > 0 ? (
                    <pre className={styles.preFormatted}>{JSON.stringify(discoveredDevices, null, 2)}</pre>
                 ) : <p>No devices discovered in last scan.</p>}
            </div>

             <div className={styles.section}>
                <h3>Device Reachability</h3>
                 {Object.keys(reachability).length > 0 ? (
                    <pre className={styles.preFormatted}>{JSON.stringify(reachability, null, 2)}</pre>
                 ) : <p>No reachability data available.</p>}
            </div>
        </div>
    );
}