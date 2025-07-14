// src/app/devices/[deviceId]/page.js
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
// Import necessary Firestore functions for delete
import { doc, onSnapshot, updateDoc, deleteDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '@/lib/firebaseClient'; // Corrected path
import AuthGuard from "@/app/components/AuthGuard"; // Corrected path
import LoadingSpinner from '@/app/components/LoadingSpinner'; // Corrected path
import DeviceDetailView from '@/app/components/DeviceDetailView'; // Use the updated one below
import DeviceConfigForm from '@/app/components/DeviceConfigForm'; // Use the updated one below
import styles from "@/app/styles/Page.module.css"; // Corrected path

// Lazy-load the functions instance
let functions;
let triggerTestNotification;

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
  
  // --- New State for Test Notification Modal ---
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testSendResult, setTestSendResult] = useState(null);
  const [testChannels, setTestChannels] = useState({ email: true, sms: true });

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

  const handleSendTestNotification = async () => {
    if (!deviceId) return;
    if (!testChannels.email && !testChannels.sms) {
        setTestSendResult({ type: 'error', message: 'Please select at least one channel (Email or SMS).' });
        return;
    }

    setIsSendingTest(true);
    setTestSendResult(null);

    try {
        if (!functions) {
            functions = getFunctions(firebaseApp, 'europe-west1');
            triggerTestNotification = httpsCallable(functions, 'triggerTestNotification');
        }
        const result = await triggerTestNotification({ 
            deviceId,
            sendEmail: testChannels.email,
            sendSms: testChannels.sms
        });
        setTestSendResult({ type: 'success', message: result.data.message });
    } catch (error) {
        console.error("Error sending test notification:", error);
        setTestSendResult({ type: 'error', message: `Failed: ${error.message}` });
    } finally {
        setIsSendingTest(false);
        setTimeout(() => setIsTestModalOpen(false), 3000); // Close modal after 3 seconds
    }
  };

  const openTestModal = () => {
    setTestSendResult(null);
    setIsSendingTest(false);
    setTestChannels({ email: true, sms: true });
    setIsTestModalOpen(true);
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
                   
                    <button onClick={openTestModal} className="button button-secondary">Send Test Notification</button>

                   <button onClick={() => router.push('/recipients')} className="button button-secondary">Manage Recipients</button>
                   
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

      {isTestModalOpen && (
        <div className="modal-backdrop">
            <div className="modal-content">
                <h3>Send Test Notification</h3>
                <p>Select channels and send a test notification for this device.</p>
                <div className="checkbox-group">
                    <label>
                        <input type="checkbox" checked={testChannels.email} onChange={e => setTestChannels(p => ({...p, email: e.target.checked}))} />
                        Send Email
                    </label>
                    <label>
                        <input type="checkbox" checked={testChannels.sms} onChange={e => setTestChannels(p => ({...p, sms: e.target.checked}))} />
                        Send SMS
                    </label>
                </div>
                <div className="modal-actions">
                    <button onClick={() => setIsTestModalOpen(false)} disabled={isSendingTest} className="button button-secondary">Cancel</button>
                    <button onClick={handleSendTestNotification} disabled={isSendingTest} className="button">
                        {isSendingTest ? <LoadingSpinner size="small" /> : 'Send Test'}
                    </button>
                </div>
                {testSendResult && (
                    <p className={`modal-result ${testSendResult.type === 'error' ? 'result-error' : 'result-success'}`}>
                        {testSendResult.message}
                    </p>
                )}
            </div>
        </div>
      )}

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
        .modal-backdrop {
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background-color: rgba(0, 0, 0, 0.6);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 2000;
        }
        .modal-content {
            background-color: rgb(var(--card-rgb));
            padding: 2rem;
            border-radius: var(--border-radius);
            border: 1px solid rgb(var(--card-border-rgb));
            width: 90%;
            max-width: 500px;
        }
        .modal-content h3 {
            margin-bottom: 0.5rem;
            color: rgb(var(--primary-rgb));
        }
        .modal-content p {
            margin-bottom: 1.5rem;
            color: rgb(var(--secondary-rgb));
        }
        .checkbox-group {
            display: flex;
            gap: 2rem;
            margin-bottom: 2rem;
        }
        .checkbox-group label {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            cursor: pointer;
        }
        .checkbox-group input {
            width: 18px; height: 18px;
            accent-color: rgb(var(--primary-rgb));
        }
        .modal-actions {
            display: flex;
            justify-content: flex-end;
            gap: 1rem;
        }
        .modal-result {
            margin-top: 1rem;
            padding: 0.8rem;
            border-radius: calc(var(--border-radius) / 2);
            text-align: center;
        }
        .result-success {
            background-color: rgba(var(--success-rgb), 0.2);
            color: rgb(var(--success-rgb));
        }
        .result-error {
            background-color: rgba(var(--error-rgb), 0.2);
            color: rgb(var(--error-rgb));
        }
      `}</style>
    </AuthGuard>
  );
}