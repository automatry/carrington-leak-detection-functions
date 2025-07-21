// client/src/app/components/DeviceCard.js
import Link from 'next/link';
import styles from './DeviceCard.module.css';
import { useMemo, useState } from 'react';
import LoadingSpinner from './LoadingSpinner';

// NEW: Import Firestore functions to handle the 'approve' action
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';

// Helper function to get status class (simplified for boolean flags)
const getBooleanStatusClass = (flag, trueClass, falseClass) => {
  return flag ? (styles[trueClass] || '') : (styles[falseClass] || '');
};

// Helper to capitalize words for better display
const capitalize = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

export default function DeviceCard({ device }) {
  // Destructure properties, now including provisioningStatus and approvedForProvisioning
  const { id, serial, hash, friendlyName, provisioningStatus, approvedForProvisioning, identity, state, config } = device || {};
  const { commissioned, APARTMENT, PROJECT } = identity || {};
  const { lastUpdate, connectivity_status, leak_status, service_status, socket_status, network } = state || {};
  const { bacnet } = config || {};

  // --- States for card actions ---
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState(null);
  // --- END States ---

  // --- Data Preparation ---
  const apartmentName = APARTMENT || 'Unassigned';
  const displayFriendlyName = friendlyName || '(No Friendly Name)';
  const displaySerial = serial || 'N/A';
  const projectName = PROJECT || 'Unassigned';
  const deviceIP = network?.deviceIP || 'N/A';
  const points = bacnet?.read_points || [];
  const primarySensor = useMemo(() => points.find((p) => p.is_primary_leak_sensor === true), [points]);
  const primarySensorDetails = state?.primary_leak_sensor_details;
  
  // --- NEW: Stale Status Check ---
  // Checks if the lastUpdate timestamp is more than 5 minutes ago
  const isStale = useMemo(() => {
    if (!lastUpdate) return false;
    const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;
    const lastUpdateTime = lastUpdate.toDate ? lastUpdate.toDate().getTime() : 0;
    // Return true only if a valid timestamp exists and it's older than 5 minutes
    return lastUpdateTime > 0 && (Date.now() - lastUpdateTime > FIVE_MINUTES_IN_MS);
  }, [lastUpdate]);

  const lastUpdateString = useMemo(() => {
    if (!lastUpdate) return 'N/A';
    const date = lastUpdate.toDate ? lastUpdate.toDate() : new Date(lastUpdate.seconds * 1000);
    return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleString();
  }, [lastUpdate]);

  // --- UPDATED: Status Classes & Text ---
  // Logic is now based on the more reliable 'provisioningStatus' field
  const isProvisioned = provisioningStatus === 'provisioning_complete';
  const provisionedClass = getBooleanStatusClass(isProvisioned, 'statusProvisioned', 'statusNotProvisioned');
  const provisionedText = isProvisioned ? 'Provisioned' : capitalize(provisioningStatus || 'Not Provisioned');

  const commissionedClass = getBooleanStatusClass(commissioned, 'statusCommissioned', 'statusNotCommissioned');
  const commissionedText = commissioned ? 'Commissioned' : 'Not Commissioned';

  const connectivityClass = styles[`status${connectivity_status?.toLowerCase()}`] || styles.statusUnknown;
  const leakClass = styles[`status${leak_status?.toLowerCase()}`] || styles.statusUnknown;
  const serviceClass = styles[`status${service_status?.toLowerCase()}`] || styles.statusUnknown;
  const socketClass = styles[`status${socket_status?.toLowerCase()}`] || styles.statusUnknown;

  // --- NEW: Approve Handler ---
  const handleApproveClick = async (e) => {
    e.stopPropagation();
    e.preventDefault();

    if (!id) {
        console.error("Device ID is missing, cannot approve.", { device });
        setApproveError("Cannot approve: Device ID is missing.");
        return;
    }

    setIsApproving(true);
    setApproveError(null);
    console.log(`Approving device: ${id}`);
    const docRef = doc(db, 'devices', id);

    try {
        await updateDoc(docRef, {
            approvedForProvisioning: true,
            provisioningStatus: 'approved',
        });
        console.log(`Device ${id} approved successfully.`);
    } catch (error) {
        console.error("Error approving device:", error);
        setApproveError(`Approval failed: ${error.message}`);
    } finally {
        setIsApproving(false);
    }
  };

  // --- Download Handler (remains the same) ---
  const handleDownloadClick = async (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (!hash) {
           console.error("Error: Device hash is missing, cannot generate provision script URL.", { device });
           setDownloadError("Device data is incomplete (missing hash).");
           return;
      }
      const functionBaseUrl = process.env.NEXT_PUBLIC_GET_PROVISION_SCRIPT_URL;
      if (!functionBaseUrl) {
          console.error("Error: NEXT_PUBLIC_GET_PROVISION_SCRIPT_URL is not defined.");
          setDownloadError("Provisioning script URL is not configured.");
          return;
      }

      setIsDownloading(true);
      setDownloadError(null);
      console.log(`Requesting provision script for device hash: ${hash}`);

      let downloadUrl;
      try {
        const url = new URL(functionBaseUrl);
        url.searchParams.append('device_hash', hash);
        downloadUrl = url.toString();
      } catch (error) {
          console.error("Error constructing download URL:", error);
          setDownloadError(`Invalid script URL configured.`);
          setIsDownloading(false);
          return;
      }

      try {
          const response = await fetch(downloadUrl);

          if (!response.ok) {
              let errorBody = `HTTP error! Status: ${response.status}`;
              try { errorBody = (await response.text()) || errorBody; } catch (_) {}
              throw new Error(errorBody);
          }

          const scriptText = await response.text();
          const blob = new Blob([scriptText], { type: 'text/x-shellscript' });
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = objectUrl;
          const filename = `provision-${serial || id}.sh`;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(objectUrl);
          console.log(`Successfully triggered download for ${filename}`);
      } catch (error) {
          console.error("Error downloading provisioning script:", error);
          setDownloadError(`Download failed: ${error.message}`);
      } finally {
          setIsDownloading(false);
      }
  };

  if (!id) {
    return <div className={styles.cardError}>Invalid Device Data</div>;
  }

  return (
    <div className={`${styles.cardContainer} ${isStale ? styles.stale : ''}`}>
      <Link href={`/devices/${id}`} className={styles.cardLink}>
        <div className={styles.card}>
          <div className={styles.header}>
            <div className={styles.titleSection}>
              <h3 className={styles.apartmentName} title={apartmentName}>
                {apartmentName}
              </h3>
              <p className={styles.friendlyNameDisplay} title={displayFriendlyName}>
                {displayFriendlyName}
              </p>
              <p className={styles.serialDisplay} title={displaySerial}>
                Serial: {displaySerial}
              </p>
            </div>
            <div className={styles.statusBadges}>
              <span className={`${styles.statusBadge} ${provisionedClass}`} title={`Provisioning Status: ${provisioningStatus || 'unknown'}`}>
                {provisionedText}
              </span>
              <span className={`${styles.statusBadge} ${commissionedClass}`}>
                {commissionedText}
              </span>
            </div>
          </div>
          <p className={styles.project} title={projectName}>Project: {projectName}</p>
          <div className={styles.infoGrid}>
             <div className={styles.infoItem}>
              <span className={styles.label}>Connectivity:</span>
              <span className={`${styles.value} ${connectivityClass}`}>{connectivity_status || 'unknown'}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.label}>Leak Status:</span>
              <span className={`${styles.value} ${leakClass}`}>{leak_status || 'unknown'}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.label}>Service:</span>
              <span className={`${styles.value} ${serviceClass}`}>{service_status || 'unknown'}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.label}>Socket:</span>
              <span className={`${styles.value} ${socketClass}`}>{socket_status || 'unknown'}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.label}>IP Address:</span>
              <span className={styles.value}>{deviceIP}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.label}>Last Update:</span>
              <span className={`${styles.value} ${isStale ? styles.staleValue : ''}`}>
                {isStale && <span className={styles.staleIndicator} title="Device has not reported in over 5 minutes">⚠️ </span>}
                {lastUpdateString}
              </span>
            </div>
          </div>
          <div className={styles.footerSection}>
            {primarySensor && (
                <div className={styles.primarySensorInfo}>
                <span className={styles.label}>Primary Sensor ({primarySensor.id || 'N/A'}):</span>
                <span>
                    {primarySensor.object_type} / {primarySensor.object_instance}
                    {primarySensorDetails?.current_value !== undefined && ` (${primarySensorDetails.current_value})`}
                </span>
                </div>
            )}
            <div className={styles.pointCount}>
                {points.length} Read Point(s) Configured
            </div>
          </div>
        </div>
      </Link>

      {/* --- REVISED Action Section --- */}
      {/* This section now shows conditionally based on the correct provisioning status */}
      {!isProvisioned && (
        <div className={styles.provisionSection}>
            {/* Approve button appears when device is awaiting approval */}
            {provisioningStatus === 'awaiting_approval' && (
                <button
                    className={styles.approveButton}
                    onClick={handleApproveClick}
                    title="Approve this device for provisioning"
                    disabled={isApproving}
                >
                    {isApproving ? (
                        <>
                            <LoadingSpinner size="small" />
                            <span>Approving...</span>
                        </>
                    ) : (
                        'Approve Device'
                    )}
                </button>
            )}

            {/* Download button appears AFTER approval but before provisioning is complete */}
            {approvedForProvisioning && (
                <button
                    className={styles.provisionButton}
                    onClick={handleDownloadClick}
                    title="Download provisioning script for this device"
                    disabled={isDownloading}
                >
                    {isDownloading ? (
                        <>
                            <LoadingSpinner size="small" />
                            <span>Downloading...</span>
                        </>
                    ) : (
                        'Download Provision Script'
                    )}
                </button>
            )}
            
            {/* Display any error from actions */}
            {(downloadError || approveError) && (
                <p className={styles.downloadErrorText}>
                    {downloadError || approveError}
                </p>
            )}
        </div>
      )}
    </div>
  );
}