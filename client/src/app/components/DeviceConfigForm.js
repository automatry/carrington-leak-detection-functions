// src/app/components/DeviceConfigForm.js
"use client";

import { useState, useEffect } from 'react';
import styles from './DeviceConfigForm.module.css'; // Create this CSS module

export default function DeviceConfigForm({ initialData, onSave, onCancel }) {
  // Initialize form state with potentially nested data
  const [formData, setFormData] = useState({
      identity: { ...initialData?.identity }, // Shallow copy identity
      config: {
          // Deep copy config sections that might be heavily modified
          bacnet: JSON.parse(JSON.stringify(initialData?.config?.bacnet || { read_points: [] })),
          flags: { ...(initialData?.config?.flags || {}) },
          logging: { ...(initialData?.config?.logging || {}) },
          service: { ...(initialData?.config?.service || {}) }
      }
  });
  const [isSaving, setIsSaving] = useState(false);

  // Update form if initialData changes (e.g., due to snapshot update while editing)
  // Be cautious with this, might overwrite user edits. Consider disabling edit fields
  // or providing a reset button if external updates are frequent.
  useEffect(() => {
      setFormData({
          identity: { ...initialData?.identity },
          config: {
              bacnet: JSON.parse(JSON.stringify(initialData?.config?.bacnet || { read_points: [] })),
              flags: { ...(initialData?.config?.flags || {}) },
              logging: { ...(initialData?.config?.logging || {}) },
              service: { ...(initialData?.config?.service || {}) }
          }
      });
  }, [initialData]);


  // --- Handlers for top-level identity fields ---
  const handleIdentityChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      identity: {
        ...prev.identity,
        [name]: type === 'checkbox' ? checked : value
      }
    }));
  };

  // --- Handlers for config.flags ---
  const handleFlagChange = (e) => {
    const { name, checked } = e.target; // Flags are checkboxes
     setFormData(prev => ({
      ...prev,
      config: {
          ...prev.config,
          flags: {
              ...prev.config.flags,
              [name]: checked
          }
      }
    }));
  };

   // --- Handlers for config.bacnet.read_points ---
   const handlePointChange = (index, field, value, type = 'text') => {
      const newPoints = [...formData.config.bacnet.read_points];
      const point = { ...newPoints[index] }; // Copy the point object

      if (type === 'checkbox') {
          point[field] = value; // Directly use boolean value for checkboxes
      } else if (type === 'number') {
          point[field] = value === '' ? null : Number(value); // Convert to number or null if empty
      } else {
          point[field] = value;
      }

      newPoints[index] = point; // Update the point in the copied array
      setFormData(prev => ({
          ...prev,
          config: { ...prev.config, bacnet: { ...prev.config.bacnet, read_points: newPoints }}
      }));
  };

  const addPoint = () => {
      const newPoint = {
          id: `new_point_${Date.now()}`, // Generate a temporary unique ID
          description: "New Read Point",
          is_primary_leak_sensor: false,
          target_ip: null,
          target_device_instance: null,
          object_type: "binaryInput",
          object_instance: 1,
          property_identifier: "presentValue",
          invert_polarity: false
      };
      setFormData(prev => ({
          ...prev,
          config: { ...prev.config, bacnet: { ...prev.config.bacnet, read_points: [...prev.config.bacnet.read_points, newPoint] }}
      }));
  };

  const removePoint = (index) => {
      if (window.confirm("Are you sure you want to remove this read point?")) {
           const newPoints = formData.config.bacnet.read_points.filter((_, i) => i !== index);
            // Check if removing the primary sensor
            const removedPointWasPrimary = formData.config.bacnet.read_points[index]?.is_primary_leak_sensor;
            if (removedPointWasPrimary && newPoints.length > 0 && !newPoints.some(p => p.is_primary_leak_sensor)) {
                // If primary was removed and others exist, prompt to set a new one or make the first one primary
                alert("Primary leak sensor removed. Please designate a new primary sensor.");
                // Optionally, automatically make the first point primary:
                // newPoints[0].is_primary_leak_sensor = true;
            }
            setFormData(prev => ({
                ...prev,
                config: { ...prev.config, bacnet: { ...prev.config.bacnet, read_points: newPoints }}
            }));
      }
  };

  // Handle Primary Sensor Toggle - ensures only one is true
  const handlePrimarySensorToggle = (index) => {
       const newPoints = formData.config.bacnet.read_points.map((point, i) => ({
           ...point,
           is_primary_leak_sensor: i === index // Set true only for the clicked one
       }));
       setFormData(prev => ({
           ...prev,
           config: { ...prev.config, bacnet: { ...prev.config.bacnet, read_points: newPoints }}
       }));
  }


  // --- Form Submission ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    // Basic validation could be added here before saving
    // For example, check if 'commissioned' is true but no primary sensor exists
     const commissioned = formData.identity.commissioned;
     const hasPrimary = formData.config.bacnet.read_points.some(p => p.is_primary_leak_sensor);
     if (commissioned && !hasPrimary && formData.config.bacnet.read_points.length > 0) {
         alert("Cannot save: Device is commissioned but no primary leak sensor is designated.");
         setIsSaving(false);
         return;
     }

    await onSave(formData); // Pass the entire structure back
    setIsSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <h2>Edit Configuration</h2>

      {/* --- Identity Section --- */}
      <fieldset className={styles.fieldset}>
        <legend>Identity</legend>
        <div className={styles.fieldGroup}>
            <label htmlFor="apartment">Apartment Name:</label>
            <input type="text" id="apartment" name="APARTMENT" value={formData.identity.APARTMENT || ''} onChange={handleIdentityChange} />
        </div>
        <div className={styles.fieldGroup}>
            <label htmlFor="project">Project:</label>
            <input type="text" id="project" name="PROJECT" value={formData.identity.PROJECT || ''} onChange={handleIdentityChange} />
        </div>
        <div className={styles.fieldGroup}>
            <label htmlFor="apartmentId">Apartment ID:</label>
            <input type="text" id="apartmentId" name="APARTMENT_ID" value={formData.identity.APARTMENT_ID || ''} onChange={handleIdentityChange} />
        </div>
        <div className={styles.fieldGroupCheckbox}>
             <input type="checkbox" id="commissioned" name="commissioned" checked={formData.identity.commissioned || false} onChange={handleIdentityChange} />
            <label htmlFor="commissioned">Commissioned</label>
        </div>
      </fieldset>

       {/* --- Flags Section --- */}
       <fieldset className={styles.fieldset}>
            <legend>Flags</legend>
            <div className={styles.checkboxGrid}>
                {Object.entries(formData.config.flags || {}).map(([flagKey, flagValue]) => (
                    <div key={flagKey} className={styles.fieldGroupCheckboxInline}>
                         <input type="checkbox" id={`flag-${flagKey}`} name={flagKey} checked={flagValue || false} onChange={handleFlagChange} />
                        <label htmlFor={`flag-${flagKey}`}>{flagKey.replace(/_/g, ' ')}</label>
                    </div>
                ))}
            </div>
       </fieldset>

      {/* --- BACnet Read Points Section --- */}
      <fieldset className={styles.fieldset}>
        <legend>BACnet Read Points</legend>
        {formData.config.bacnet.read_points.map((point, index) => (
          <div key={point.id || index} className={styles.pointCard}>
            <div className={styles.pointHeader}>
              <input type="text" placeholder="Point ID (e.g., leak_sensor_1)" value={point.id || ''} onChange={(e) => handlePointChange(index, 'id', e.target.value)} required/>
              <button type="button" onClick={() => removePoint(index)} className={styles.removeButton}>×</button>
            </div>
            <input type="text" placeholder="Description" value={point.description || ''} onChange={(e) => handlePointChange(index, 'description', e.target.value)} />
            <div className={styles.pointGrid}>
                <input type="number" placeholder="Target Device Instance" value={point.target_device_instance ?? ''} onChange={(e) => handlePointChange(index, 'target_device_instance', e.target.value, 'number')} />
                <input type="text" placeholder="Object Type (e.g., binaryInput)" value={point.object_type || ''} onChange={(e) => handlePointChange(index, 'object_type', e.target.value)} required/>
                <input type="number" placeholder="Object Instance" value={point.object_instance ?? ''} onChange={(e) => handlePointChange(index, 'object_instance', e.target.value, 'number')} required/>
                <input type="text" placeholder="Property ID (e.g., presentValue)" value={point.property_identifier || 'presentValue'} onChange={(e) => handlePointChange(index, 'property_identifier', e.target.value)} />
            </div>
             <div className={styles.checkboxGroup}>
                <div className={styles.fieldGroupCheckboxInline}>
                    <input type="checkbox" id={`primary-${index}`} checked={point.is_primary_leak_sensor || false} onChange={(e) => handlePrimarySensorToggle(index)} />
                    <label htmlFor={`primary-${index}`}>Is Primary Leak Sensor</label>
                </div>
                 <div className={styles.fieldGroupCheckboxInline}>
                    <input type="checkbox" id={`invert-${index}`} checked={point.invert_polarity || false} onChange={(e) => handlePointChange(index, 'invert_polarity', e.target.checked, 'checkbox')} />
                    <label htmlFor={`invert-${index}`}>Invert Polarity</label>
                </div>
             </div>
          </div>
        ))}
        <button type="button" onClick={addPoint} className="button button-secondary" style={{marginTop: '1rem'}}>+ Add Point</button>
      </fieldset>

      {/* Add fieldsets for logging and service if needed */}

      {/* --- Actions --- */}
      <div className={styles.actions}>
        <button type="button" onClick={onCancel} disabled={isSaving} className="button button-secondary">Cancel</button>
        <button type="submit" disabled={isSaving} className="button">
          {isSaving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </form>
  );
}