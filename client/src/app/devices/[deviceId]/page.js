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
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [isApproving, setIsApproving] = useState(false);

  useEffect(() => {
    if (!deviceId) {
      setError("Device ID not found in URL.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setDeleteError(null); 
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

  const handleSaveConfig = useCallback(async (updatedConfigData) => {
      if (!deviceId) return;
      console.log("Attempting to save config for device:", deviceId, updatedConfigData);
      const docRef = doc(db, 'devices', deviceId);
      try {
          const isCommissioned = updatedConfigData.identity.commissioned;
          await updateDoc(docRef, {
              'identity': updatedConfigData.identity,
              'config': updatedConfigData.config,
              'approvedForProvisioning': deviceData?.approvedForProvisioning || isCommissioned,
              'state.lastUpdate': new Date()
          });
          console.log("Device config updated successfully!");
          setIsEditing(false);
      } catch (err) {
          console.error("Error updating device config:", err);
          setError(`Failed to save configuration: ${err.message}`);
      }
  }, [deviceId, deviceData]);

  const handleApprovalToggle = async () => {
    if (!deviceId) return;

    const newApprovalStatus = !deviceData?.approvedForProvisioning;
    const confirmMessage = newApprovalStatus
      ? `Are you sure you want to APPROVE registration for device "${deviceData.serial}"? The device will then download its credentials.`
      : `Are you sure you want to REVOKE approval for device "${deviceData.serial}"?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setIsApproving(true);
    setError(null);
    console.log(`Setting approvedForProvisioning to ${newApprovalStatus} for device: ${deviceId}`);
    const docRef = doc(db, 'devices', deviceId);
    try {
      await updateDoc(docRef, {
        approvedForProvisioning: newApprovalStatus,
        provisioningStatus: newApprovalStatus ? 'approved' : 'awaiting_approval',
      });
      console.log("Device approval status updated successfully.");
    } catch (err) {
      console.error("Error updating device approval status:", err);
      setError(`Failed to update approval: ${err.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  const handleDeleteDevice = async () => {
      if (!deviceId || !deviceData?.serial) return; 

      if (!window.confirm(`Are you sure you want to permanently delete device "${deviceData.serial}" (ID: ${deviceId})? This action cannot be undone.`)) {
          return; 
      }

      setIsDeleting(true);
      setDeleteError(null);
      console.log(`Attempting to delete device: ${deviceId}`);

      try {
          const docRef = doc(db, 'devices', deviceId);
          await deleteDoc(docRef);
          console.log(`Device ${deviceId} deleted successfully.`);
          router.push('/devices');
      } catch (err) {
          console.error(`Error deleting device ${deviceId}:`, err);
          setDeleteError(`Failed to delete device: ${err.message}`);
          setIsDeleting(false); 
      }
  };

  if (loading) return <AuthGuard><LoadingSpinner /></AuthGuard>; 

  return (
    <AuthGuard>
      <div className={styles.container}>
        <button onClick={() => router.push('/devices')} className="button button-secondary" style={{ marginBottom: '1.5rem' }}>
            ← Back to Devices
        </button>

        {error && !isEditing && <p className="error-message">{error}</p>}

        {!deviceData && !loading && !error && (
             <p>Device data could not be loaded or the device does not exist.</p>
        )}

        {deviceData && (
          <>
            {!isEditing ? (
              <>
                <DeviceDetailView device={deviceData} />
                <div className={styles.actionsContainer} style={{ marginTop: '2rem', display: 'flex', gap: '1rem', justifyContent:'flex-end', flexWrap: 'wrap' }}>
                   {deleteError && <p className="error-message" style={{margin: 0, alignSelf:'center', flexGrow:1}}>{deleteError}</p>}
                   
                   {/* Tweaked Approval Button Logic/Text */ }
                   {deviceData.provisioningStatus !== 'provisioning_complete' && (
                     <button
                       onClick={handleApprovalToggle}
                       className={`button ${deviceData.approvedForProvisioning ? 'button-secondary' : ''}`}
                       disabled={isApproving || isDeleting}
                       style={deviceData.approvedForProvisioning ? {} : {backgroundColor: 'rgb(var(--success-rgb))'}}
                     >
                       {isApproving ? 'Updating...' : (deviceData.approvedForProvisioning ? 'Revoke Approval' : 'Approve Registration')}
                     </button>
                   )}
                   
                   <button
                     onClick={handleDeleteDevice}
                     className="button button-danger" 
                     disabled={isDeleting || isApproving}
                     style={{backgroundColor: 'rgb(var(--error-rgb))'}}
                   >
                     {isDeleting ? 'Deleting...' : 'Delete Device'}
                   </button>
                   
                   <button
                     onClick={() => setIsEditing(true)}
                     className="button"
                     disabled={isDeleting || isApproving}
                   >
                     Edit Configuration
                   </button>
                </div>
              </>
            ) : (
              <DeviceConfigForm
                initialData={deviceData}
                onSave={handleSaveConfig}
                onCancel={() => { setError(null); setIsEditing(false); }}
              />
            )}
          </>
        )}
      </div>
      <style jsx>{`
        .error-message {
          color: rgb(var(--error-rgb));
          background-color: rgba(var(--error-rgb), 0.1);
          padding: 0.8rem 1rem;
          border-radius: var(--border-radius);
          border: 1px solid rgba(var(--error-rgb), 0.3);
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
        }
      `}</style>
    </AuthGuard>
  );
}