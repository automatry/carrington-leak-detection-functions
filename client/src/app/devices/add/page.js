// app/devices/add/page.js
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
// Import necessary Firestore functions
import { collection, addDoc, serverTimestamp, query, where, getDocs, limit } from "firebase/firestore";
import { db } from "@/lib/firebaseClient"; // Ensure this path is correct
import AuthGuard from "@/app/components/AuthGuard";
import styles from "@/app/styles/Page.module.css";
import crypto from "crypto-browserify"; // Use the polyfill

export default function AddDevicePage() {
  const [serial, setSerial] = useState("");
  const [friendlyName, setFriendlyName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedSerial = serial.trim(); // Trim serial upfront
    if (!trimmedSerial) {
      setError("Serial number is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // --- CHECK FOR DUPLICATE SERIAL ---
      console.log(`Checking for existing device with serial: ${trimmedSerial}`);
      const devicesRef = collection(db, "devices");
      const q = query(devicesRef, where("serial", "==", trimmedSerial), limit(1));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        console.warn(`Duplicate serial found: ${trimmedSerial}`);
        setError(`A device with serial number "${trimmedSerial}" already exists.`);
        setLoading(false);
        return; // Stop execution
      }
      console.log(`Serial ${trimmedSerial} is unique.`);
      // --- END DUPLICATE CHECK ---

      // --- HASH GENERATION ---
      let serialHash = "";
      try {
        if (!crypto || typeof crypto.createHash !== 'function') {
           throw new Error("Crypto library not available or createHash is not a function.");
        }
         serialHash = crypto.createHash("sha256")
                            .update(trimmedSerial) // Use the trimmed serial
                            .digest("hex");
         console.log(`Generated SHA-256 hash for ${trimmedSerial}: ${serialHash}`);
      } catch (hashError) {
        console.error("Error generating SHA-256 hash:", hashError);
        setError(`Failed to generate device hash: ${hashError.message}. Cannot add device.`);
        setLoading(false);
        return;
      }
      // --- END HASH GENERATION ---

      // --- ADD DEVICE TO FIRESTORE ---
      const newDeviceData = {
        serial: trimmedSerial, // Use trimmed serial
        friendlyName: friendlyName.trim() || `Device ${trimmedSerial}`,
        hash: serialHash,
        registered: false,
        provisioningStatus: 'not_provisioned',
        identity: {
          commissioned: false,
          APARTMENT: null,
          PROJECT: null
        },
        state: {
           connectivity_status: 'unknown',
           leak_status: 'unknown'
        },
        createdAt: serverTimestamp(),
      };
      console.log("Adding device with data:", JSON.stringify(newDeviceData));

      const docRef = await addDoc(collection(db, "devices"), newDeviceData);

      console.log("Device added successfully with ID:", docRef.id);
      setLoading(false);
      router.push("/devices"); // Navigate back to device list
      // --- END ADD DEVICE ---

    } catch (err) {
      // Catch errors from duplicate check or addDoc
      console.error("Error during device addition process:", err);
      setError(`Failed to add device: ${err.message}. Please check console and Firestore rules.`);
      setLoading(false);
    }
  };

  return (
    <AuthGuard>
      <div className={styles.container}>
        <h1>Add New Device</h1>
        <form onSubmit={handleSubmit} style={{ maxWidth: "400px", margin: "0 auto" }}>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="serial">Serial Number:</label>
            <input
              id="serial"
              type="text"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              required
              style={{ width: "100%", padding: "0.5rem" }}
              aria-describedby="serial-error" // For accessibility
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="friendlyName">Friendly Name:</label>
            <input
              id="friendlyName"
              type="text"
              value={friendlyName}
              onChange={(e) => setFriendlyName(e.target.value)}
              placeholder="Optional: E.g. Apartment 101"
              style={{ width: "100%", padding: "0.5rem" }}
            />
          </div>
          {error && <p id="serial-error" style={{ color: "rgb(var(--error-rgb))", marginTop:'1rem' }}>Error: {error}</p>}
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Adding Device..." : "Add Device"}
          </button>
        </form>
      </div>
    </AuthGuard>
  );
}