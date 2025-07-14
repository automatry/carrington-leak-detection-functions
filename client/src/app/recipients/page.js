"use client";

import { useState, useEffect } from "react";
import { collection, doc, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import AuthGuard from "@/app/components/AuthGuard";
import styles from "@/app/styles/Page.module.css";
import pageStyles from "./page.module.css";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import RecipientManager from "@/app/components/RecipientManager";

export default function RecipientsPage() {
  const [devices, setDevices] = useState([]);
  const [recipientsMap, setRecipientsMap] = useState({});
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch all devices
  useEffect(() => {
    const q = collection(db, "devices");
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const deviceList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setDevices(deviceList);
      if (!selectedDeviceId && deviceList.length > 0) {
        setSelectedDeviceId(deviceList[0].id);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [selectedDeviceId]);

  // Fetch all recipients and create a map
  useEffect(() => {
    const q = collection(db, "recipients");
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newMap = {};
      snapshot.forEach(doc => {
        newMap[doc.id] = doc.data();
      });
      setRecipientsMap(newMap);
    });
    return () => unsubscribe();
  }, []);
  
  const handleSaveRecipients = async (updatedData) => {
    if (!selectedDeviceId) return;
    setIsSaving(true);
    const docRef = doc(db, 'recipients', selectedDeviceId);
    try {
        await setDoc(docRef, updatedData, { merge: true });
        alert("Recipients saved successfully!");
    } catch (error) {
        console.error("Error saving recipients:", error);
        alert(`Error saving recipients: ${error.message}`);
    } finally {
        setIsSaving(false);
    }
  };

  const selectedDeviceRecipients = recipientsMap[selectedDeviceId] || { emails: [], sms: [] };

  if (loading) {
    return <AuthGuard><LoadingSpinner /></AuthGuard>;
  }

  return (
    <AuthGuard>
      <div className={styles.container}>
        <h1>Notification Recipient Management</h1>
        <p>Select a device to manage its specific notification recipients. Bulk actions coming soon.</p>
        <div className={pageStyles.managerLayout}>
          <div className={pageStyles.deviceList}>
            <h3>Devices</h3>
            <ul>
              {devices.map(device => (
                <li 
                  key={device.id} 
                  className={selectedDeviceId === device.id ? pageStyles.selected : ""}
                  onClick={() => setSelectedDeviceId(device.id)}
                >
                  {device.identity?.APARTMENT || device.friendlyName || device.serial}
                  <small>{device.id}</small>
                </li>
              ))}
            </ul>
          </div>
          <div className={pageStyles.editor}>
            {selectedDeviceId ? (
                <RecipientManager
                    key={selectedDeviceId} // Force re-render on device change
                    initialData={selectedDeviceRecipients}
                    onSave={handleSaveRecipients}
                    onCancel={() => {}} // No cancel action here, just select another device
                    isSaving={isSaving}
                />
            ) : (
                <p>Select a device from the list to begin.</p>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}