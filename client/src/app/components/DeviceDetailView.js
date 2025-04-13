// src/app/components/DeviceDetailView.js
import styles from './DeviceDetailView.module.css'; // Use the updated one below
import { useMemo } from 'react';

// Reusable status class helper
const getStatusClass = (status) => {
    const statusLower = status?.toLowerCase() || 'unknown';
    // Map common statuses to CSS classes (ensure these classes exist in the CSS)
    const statusMap = {
        'active': styles.statusActive,
        'inactive': styles.statusInactive,
        'online': styles.statusOnline,
        'offline': styles.statusOffline,
        'online_read_error': styles.statusReadError,
        'not_configured': styles.statusNotConfigured,
        'not_commissioned': styles.statusNotCommissioned,
        'stopped': styles.statusInactive, // Example mapping
        // Add more mappings as needed
    };
    return statusMap[statusLower] || styles.statusUnknown; // Fallback
};

// Component to render JSON data nicely within a collapsible section
const JsonSection = ({ title, data, initiallyOpen = false }) => {
    if (!data || Object.keys(data).length === 0) {
        return (
            <details className={styles.collapsibleSection}>
                <summary className={styles.summary}>{title}</summary>
                <p className={styles.noData}>No data available.</p>
            </details>
        );
    }

    return (
        <details className={styles.collapsibleSection} open={initiallyOpen}>
            <summary className={styles.summary}>{title}</summary>
            <pre className={styles.preFormatted}>
                {JSON.stringify(data, null, 2)}
            </pre>
        </details>
    );
};


export default function DeviceDetailView({ device }) {
    const { id, serial, identity, state, config } = device || {}; // Add serial

    // Extract data safely with fallbacks
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
    const livePointStates = state?.read_point_states || {};
    const firstSeen = state?.firstSeen;

    // Format timestamps
    const lastUpdateString = useMemo(() => lastUpdate?.toDate ? lastUpdate.toDate().toLocaleString() : 'N/A', [lastUpdate]);
    const firstSeenString = useMemo(() => firstSeen?.toDate ? firstSeen.toDate().toLocaleString() : 'N/A', [firstSeen]);

    // Get Status Classes
    const commissionedClass = commissioned ? styles.statusCommissioned : styles.statusNotCommissioned; // Use specific classes
    const connectivityClass = getStatusClass(connectivityStatus);
    const leakClass = getStatusClass(leakStatus);
    const serviceClass = getStatusClass(serviceStatus);
    const socketClass = getStatusClass(socketStatus);

    return (
        <div className={styles.container}>
            {/* Use consistent h2 for main title */}
            <h2>{identity?.APARTMENT || id} ({id})</h2>
            <p className={styles.project}>Project: {project}</p>

            {/* --- Identity & Status Section --- */}
            <div className={styles.section}>
                <h3>Identity & Status</h3>
                <div className={styles.grid}>
                    {/* Use consistent item structure */}
                    <div className={styles.item}><span className={styles.label}>UUID:</span> <span className={styles.valueWrap}>{id}</span></div>
                    <div className={styles.item}><span className={styles.label}>Serial:</span> <span className={styles.valueWrap}>{serial || 'N/A'}</span></div>
                    <div className={styles.item}><span className={styles.label}>Commissioned:</span> <span className={commissionedClass}>{commissioned ? 'Yes' : 'No'}</span></div>
                    <div className={styles.item}><span className={styles.label}>Connectivity:</span> <span className={connectivityClass}>{connectivityStatus}</span></div>
                    <div className={styles.item}><span className={styles.label}>Leak Status:</span> <span className={leakClass}>{leakStatus}</span></div>
                    <div className={styles.item}><span className={styles.label}>Service Status:</span> <span className={serviceClass}>{serviceStatus}</span></div>
                    <div className={styles.item}><span className={styles.label}>Socket Status:</span> <span className={socketClass}>{socketStatus}</span></div>
                    <div className={styles.item}><span className={styles.label}>Device IP:</span> <span className={styles.valueWrap}>{deviceIP}</span></div>
                    <div className={styles.item}><span className={styles.label}>First Seen:</span> <span className={styles.valueWrap}>{firstSeenString}</span></div>
                    <div className={styles.item}><span className={styles.label}>Last Update:</span> <span className={styles.valueWrap}>{lastUpdateString}</span></div>
                </div>
            </div>

            {/* --- Configured Read Points Section --- */}
            <div className={styles.section}>
                 <h3>Configured Read Points ({points.length})</h3>
                 {points.length > 0 ? (
                     <ul className={styles.pointList}> {/* Use a list for points */}
                        {points.map((point, index) => (
                            <li key={point.id || index} className={styles.pointItem}>
                                <strong>{point.id || `Point ${index + 1}`}</strong>
                                <span className={styles.pointDetails}>
                                    ({point.object_type || 'N/A'} / {point.object_instance ?? 'N/A'}) Target: {point.target_device_instance ?? 'Any'}
                                </span>
                                {point.is_primary_leak_sensor && <span className={`${styles.badge} ${styles.primaryBadge}`}>Primary</span>}
                                {point.invert_polarity && <span className={`${styles.badge} ${styles.polarityBadge}`}>Inverted</span>}
                            </li>
                        ))}
                     </ul>
                 ) : <p className={styles.noData}>No read points configured.</p>}
             </div>


             {/* --- Collapsible JSON Sections --- */}
             {/* Use the JsonSection component */}
             <JsonSection title="Primary Leak Sensor Details" data={primarySensorDetails} />
             <JsonSection title="Live Point States" data={livePointStates} />
             <JsonSection title="Discovered BACnet Devices" data={discoveredDevices} />
             <JsonSection title="Device Reachability" data={reachability} />
             {/* --- End Collapsible Sections --- */}

        </div> // End container
    );
}