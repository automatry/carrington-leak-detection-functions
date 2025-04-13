// components/DeviceCard.js
import Link from 'next/link';
import styles from './DeviceCard.module.css';
// Import useState for managing download state
import { useMemo, useState } from 'react';
import LoadingSpinner from './LoadingSpinner'; // Assuming you have a simple spinner component

// Helper function to get status class (simplified for boolean flags)
const getBooleanStatusClass = (flag, trueClass, falseClass) => {
  return flag ? (styles[trueClass] || '') : (styles[falseClass] || '');
};

export default function DeviceCard({ device }) {
  // Destructure top-level and nested properties safely
  const { id, serial, hash, friendlyName, registered, identity, state, config } = device || {}; // Ensure hash is destructured
  const { commissioned, APARTMENT, PROJECT } = identity || {};
  const { lastUpdate, connectivity_status, leak_status, service_status, socket_status, network } = state || {};
  const { bacnet } = config || {};

  // --- NEW STATE for Download ---
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  // --- END NEW STATE ---

  // --- Data Preparation --- (same as before)
  const apartmentName = APARTMENT || 'Unassigned';
  const displayFriendlyName = friendlyName || '(No Friendly Name)';
  const displaySerial = serial || 'N/A';
  const projectName = PROJECT || 'Unassigned';
  const deviceIP = network?.deviceIP || 'N/A';
  const points = bacnet?.read_points || [];
  const primarySensor = useMemo(() => points.find(p => p.is_primary_leak_sensor === true), [points]);
  const primarySensorDetails = state?.primary_leak_sensor_details;

  const lastUpdateString = useMemo(() => {
    if (!lastUpdate) return 'N/A';
    const date = lastUpdate.toDate ? lastUpdate.toDate() : new Date(lastUpdate.seconds * 1000);
    return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleString();
  }, [lastUpdate]);

  // --- Status Classes --- (same as before)
  const provisionedClass = getBooleanStatusClass(registered, 'statusProvisioned', 'statusNotProvisioned');
  const provisionedText = registered ? 'Provisioned' : 'Not Provisioned';
  const commissionedClass = getBooleanStatusClass(commissioned, 'statusCommissioned', 'statusNotCommissioned');
  const commissionedText = commissioned ? 'Commissioned' : 'Not Commissioned';

  const connectivityClass = styles[`status${connectivity_status?.toLowerCase()}`] || styles.statusUnknown;
  const leakClass = styles[`status${leak_status?.toLowerCase()}`] || styles.statusUnknown;
  const serviceClass = styles[`status${service_status?.toLowerCase()}`] || styles.statusUnknown;
  const socketClass = styles[`status${socket_status?.toLowerCase()}`] || styles.statusUnknown;

  // --- MODIFIED Download Handler ---
  const handleDownloadClick = async (e) => {
      e.stopPropagation(); // Prevent link navigation if user clicks button quickly
      e.preventDefault();   // Prevent any default button behavior

      // Ensure hash is available
      if (!hash) {
           console.error("Error: Device hash is missing, cannot generate provision script URL.", device);
           setDownloadError("Device data is incomplete (missing hash).");
           return;
      }
      // Ensure URL is configured
      const functionBaseUrl = process.env.NEXT_PUBLIC_GET_PROVISION_SCRIPT_URL;
      if (!functionBaseUrl) {
          console.error("Error: NEXT_PUBLIC_GET_PROVISION_SCRIPT_URL is not defined.");
          setDownloadError("Provisioning script URL is not configured.");
          return;
      }

      setIsDownloading(true);
      setDownloadError(null); // Clear previous errors
      console.log(`Requesting provision script for device hash: ${hash}`);

      // Construct the full URL safely
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
              // Try to get more specific error from response body if possible
              let errorBody = `HTTP error! Status: ${response.status} ${response.statusText}`;
              try {
                  const text = await response.text();
                  errorBody = text || errorBody; // Use text if available
              } catch (_) { /* Ignore parsing errors */ }
              throw new Error(errorBody);
          }

          // Get script content as text
          const scriptText = await response.text();

          // Create a Blob (file-like object)
          const blob = new Blob([scriptText], { type: 'text/x-shellscript' });

          // Create a temporary URL for the Blob
          const objectUrl = URL.createObjectURL(blob);

          // Create a temporary anchor element to trigger download
          const link = document.createElement('a');
          link.href = objectUrl;
          const filename = `provision-${serial || id}.sh`;
          link.download = filename; // Set the desired filename

          // Append to body, click, and remove (necessary for some browsers)
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          // Revoke the object URL to free up memory
          URL.revokeObjectURL(objectUrl);

          console.log(`Successfully triggered download for ${filename}`);

      } catch (error) {
          console.error("Error downloading provisioning script:", error);
          // Set user-friendly error message
          setDownloadError(`Download failed: ${error.message}`);
      } finally {
          // Ensure loading state is reset
          setIsDownloading(false);
      }
  };
  // --- END MODIFIED Download Handler ---

  if (!id) {
    return <div className={styles.cardError}>Invalid Device Data</div>;
  }

  return (
    // Main container includes card and button
    <div className={styles.cardContainer}>
      {/* Link wraps the main clickable card area */}
      <Link href={`/devices/${id}`} className={styles.cardLink}>
        <div className={styles.card}>
          {/* Header: Title + Badges */}
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
              <span className={`${styles.statusBadge} ${provisionedClass}`}>
                {provisionedText}
              </span>
              <span className={`${styles.statusBadge} ${commissionedClass}`}>
                {commissionedText}
              </span>
            </div>
          </div>
           {/* Project Info */}
          <p className={styles.project} title={projectName}>Project: {projectName}</p>
          {/* Info Grid */}
          <div className={styles.infoGrid}>
            {/* (Grid items remain the same) */}
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
              <span className={styles.value}>{lastUpdateString}</span>
            </div>
          </div>
          {/* Footer section for sensor/points */}
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
      </Link> {/* End of main clickable card link */}

      {/* Provision button and error display *outside* the Link */}
      {!registered && (
        <div className={styles.provisionSection}>
            <button
                className={styles.provisionButton}
                onClick={handleDownloadClick} // Use JS handler
                title="Download provisioning script for this device"
                disabled={isDownloading} // Disable button while downloading
            >
                {isDownloading ? (
                    <>
                        <LoadingSpinner size="small" /> {/* Use a small spinner */}
                        <span>Downloading...</span>
                    </>
                ) : (
                    'Download Provision Script'
                )}
            </button>
            {/* Display Download Error */}
            {downloadError && (
                <p className={styles.downloadErrorText}>
                    {downloadError}
                </p>
            )}
        </div>
      )}
    </div> // End card container
  );
}