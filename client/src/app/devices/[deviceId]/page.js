// src/app/devices/[deviceId]/page.js
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient'; // Corrected path
import AuthGuard from "@/app/components/AuthGuard"; // Corrected path
import LoadingSpinner from '@/app/components/LoadingSpinner'; // Corrected path
import DeviceDetailView from '@/app/components/DeviceDetailView'; // Create this
import DeviceConfigForm from '@/app/components/DeviceConfigForm'; // Create this
import styles from "@/app/styles/Page.module.css"; // Corrected path

export default function DeviceDetailPage() {
  const params = useParams();
  const router = useRouter(); // For navigation
  const deviceId = params?.deviceId;

  const [deviceData, setDeviceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false); // State to toggle edit mode

  // Fetch initial data and set up listener
  useEffect(() => {
    if (!deviceId) {
      setError("Device ID not found in URL.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    console.log(`Setting up snapshot listener for device: ${deviceId}`);

    const docRef = doc(db, 'devices', deviceId);

    // Use onSnapshot for real-time updates
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        console.log("Received device snapshot:", docSnap.data());
        setDeviceData({ id: docSnap.id, ...docSnap.data() });
        setError(null); // Clear error on successful fetch
      } else {
        console.error(`Device document with ID ${deviceId} not found.`);
        setError(`Device not found (ID: ${deviceId}).`);
        setDeviceData(null);
      }
      setLoading(false);
    }, (err) => {
      console.error(`Error fetching device ${deviceId}:`, err);
      setError("Failed to load device data. Please try again.");
      setLoading(false);
    });

    // Cleanup listener on component unmount or deviceId change
    return () => {
        console.log(`Cleaning up snapshot listener for device: ${deviceId}`);
        unsubscribe();
    }
  }, [deviceId]); // Re-run effect if deviceId changes

  // --- Save Handler ---
  const handleSaveConfig = useCallback(async (updatedConfigData) => {
      if (!deviceId) return;
      console.log("Attempting to save config for device:", deviceId, updatedConfigData);

      const docRef = doc(db, 'devices', deviceId);
      try {
          // We only update the 'identity' and 'config' fields
          await updateDoc(docRef, {
              'identity': updatedConfigData.identity,
              'config': updatedConfigData.config,
              'state.lastUpdate': new Date() // Update timestamp on edit
          });
          console.log("Device config updated successfully!");
          setIsEditing(false); // Exit edit mode on successful save
          // Optionally show a success message
      } catch (err) {
          console.error("Error updating device config:", err);
          setError(`Failed to save configuration: ${err.message}`);
          // Optionally show an error message to the user
      }
  }, [deviceId]); // Depend on deviceId

  // --- Render Logic ---
  if (loading) return <AuthGuard><LoadingSpinner fullPage={false} /></AuthGuard>;


  return (
    <AuthGuard>
      <div className={styles.container}>
        {error && <p className="error-message">{error}</p>}

        {!deviceData && !loading && !error && (
             <p>Device data could not be loaded.</p> // Should be covered by error state usually
        )}

        {deviceData && (
          <>
            {/* Back Button */}
             <button onClick={() => router.push('/devices')} className="button button-secondary" style={{ marginBottom: '1.5rem' }}>
               ← Back to Devices
             </button>

            {!isEditing ? (
              // --- View Mode ---
              <>
                <DeviceDetailView device={deviceData} />
                <button
                  onClick={() => setIsEditing(true)}
                  className="button"
                  style={{ marginTop: '2rem' }}
                >
                  Edit Configuration
                </button>
              </>
            ) : (
              // --- Edit Mode ---
              <DeviceConfigForm
                initialData={deviceData} // Pass current data to form
                onSave={handleSaveConfig}
                onCancel={() => setIsEditing(false)} // Add cancel handler
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
          padding: 1rem;
          border-radius: var(--border-radius);
          border: 1px solid rgba(var(--error-rgb), 0.3);
          margin-bottom: 1.5rem;
        }
      `}</style>
    </AuthGuard>
  );
}