// src/app/devices/[deviceId]/page.js
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
// Import necessary Firestore functions for delete
import { doc, onSnapshot, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient'; // Corrected path
import AuthGuard from "@/app/components/AuthGuard"; // Corrected path
import LoadingSpinner from '@/app/components/LoadingSpinner'; // Corrected path
import DeviceDetailView from '@/app/components/DeviceDetailView'; // Use the updated one below
import DeviceConfigForm from '@/app/components/DeviceConfigForm'; // Use the updated one below
import styles from "@/app/styles/Page.module.css"; // Corrected path

export default function DeviceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const deviceId = params?.deviceId;

  const [deviceData, setDeviceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  // --- NEW STATE FOR DELETE ---
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  // --- END NEW STATE ---

  // Fetch initial data and set up listener (useEffect remains the same as before)
  useEffect(() => {
    if (!deviceId) {
      setError("Device ID not found in URL.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setDeleteError(null); // Clear delete error on load
    console.log(`Setting up snapshot listener for device: ${deviceId}`);
    const docRef = doc(db, 'devices', deviceId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        console.log("Received device snapshot:", docSnap.data());
        setDeviceData({ id: docSnap.id, ...docSnap.data() });
        setError(null);
      } else {
        console.error(`Device document with ID ${deviceId} not found.`);
        setError(`Device not found (ID: ${deviceId}). May have been deleted.`);
        setDeviceData(null);
      }
      setLoading(false);
    }, (err) => {
      console.error(`Error fetching device ${deviceId}:`, err);
      setError("Failed to load device data. Please try again.");
      setLoading(false);
    });
    return () => {
        console.log(`Cleaning up snapshot listener for device: ${deviceId}`);
        unsubscribe();
    }
  }, [deviceId]);

  // --- Save Handler --- (useCallback remains the same)
  const handleSaveConfig = useCallback(async (updatedConfigData) => {
      if (!deviceId) return;
      console.log("Attempting to save config for device:", deviceId, updatedConfigData);
      const docRef = doc(db, 'devices', deviceId);
      try {
          await updateDoc(docRef, {
              'identity': updatedConfigData.identity,
              'config': updatedConfigData.config,
              'state.lastUpdate': new Date() // Firestore server timestamp is better if possible
              // 'state.lastUpdate': admin.firestore.FieldValue.serverTimestamp() // Only works backend
          });
          console.log("Device config updated successfully!");
          setIsEditing(false);
      } catch (err) {
          console.error("Error updating device config:", err);
          setError(`Failed to save configuration: ${err.message}`);
      }
  }, [deviceId]);

  // --- NEW DELETE HANDLER ---
  const handleDeleteDevice = async () => {
      if (!deviceId || !deviceData?.serial) return; // Need ID and serial for confirm message

      // Confirmation dialog
      if (!window.confirm(`Are you sure you want to permanently delete device "${deviceData.serial}" (ID: ${deviceId})? This action cannot be undone.`)) {
          return; // User cancelled
      }

      setIsDeleting(true);
      setDeleteError(null);
      console.log(`Attempting to delete device: ${deviceId}`);

      try {
          const docRef = doc(db, 'devices', deviceId);
          await deleteDoc(docRef);
          console.log(`Device ${deviceId} deleted successfully.`);
          // Navigate back to the device list after successful deletion
          router.push('/devices');
          // No need to setLoading(false) or setIsDeleting(false) as we are navigating away
      } catch (err) {
          console.error(`Error deleting device ${deviceId}:`, err);
          setDeleteError(`Failed to delete device: ${err.message}`);
          setIsDeleting(false); // Re-enable button on error
      }
  };
  // --- END NEW DELETE HANDLER ---

  // --- Render Logic ---
  if (loading) return <AuthGuard><LoadingSpinner /></AuthGuard>; // Show full page spinner

  return (
    <AuthGuard>
      <div className={styles.container}>
        {/* Back Button */}
        <button onClick={() => router.push('/devices')} className="button button-secondary" style={{ marginBottom: '1.5rem' }}>
            ← Back to Devices
        </button>

        {/* Display general errors */}
        {error && !isEditing && <p className="error-message">{error}</p>}

        {!deviceData && !loading && !error && (
             <p>Device data could not be loaded or the device does not exist.</p>
        )}

        {deviceData && (
          <>
            {!isEditing ? (
              // --- View Mode ---
              <>
                <DeviceDetailView device={deviceData} />
                {/* Actions Area */}
                <div className={styles.actionsContainer} style={{ marginTop: '2rem', display: 'flex', gap: '1rem', justifyContent:'flex-end' }}>
                   {/* Display delete errors */}
                   {deleteError && <p className="error-message" style={{margin: 0, alignSelf:'center', flexGrow:1}}>{deleteError}</p>}
                   {/* Delete Button */}
                   <button
                     onClick={handleDeleteDevice}
                     className="button button-danger" // Use a danger style
                     disabled={isDeleting}
                     style={{backgroundColor: 'rgb(var(--error-rgb))'}} // Inline style for emphasis
                   >
                     {isDeleting ? 'Deleting...' : 'Delete Device'}
                   </button>
                   {/* Edit Button */}
                   <button
                     onClick={() => setIsEditing(true)}
                     className="button"
                     disabled={isDeleting} // Disable edit while deleting
                   >
                     Edit Configuration
                   </button>
                </div>
              </>
            ) : (
              // --- Edit Mode ---
              <DeviceConfigForm
                initialData={deviceData}
                onSave={handleSaveConfig}
                onCancel={() => { setError(null); setIsEditing(false); }} // Clear specific config errors on cancel
              />
            )}
          </>
        )}
      </div>
      {/* Basic error styling */}
      <style jsx>{`
        .error-message {
          color: rgb(var(--error-rgb));
          background-color: rgba(var(--error-rgb), 0.1);
          padding: 0.8rem 1rem; /* Adjusted padding */
          border-radius: var(--border-radius);
          border: 1px solid rgba(var(--error-rgb), 0.3);
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
        }
      `}</style>
    </AuthGuard>
  );
}