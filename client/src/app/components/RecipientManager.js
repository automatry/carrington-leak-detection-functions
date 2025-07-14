"use client";

import { useState } from "react";
import styles from "./RecipientManager.module.css";
import { countryCodes } from "@/app/lib/countryCodes";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RecipientManager({ initialData, onSave, onCancel, isSaving }) {
  const [recipients, setRecipients] = useState(
    initialData || { emails: [], sms: [] }
  );
  const [errors, setErrors] = useState({ emails: [], sms: [] });

  const handleRecipientChange = (type, index, field, value) => {
    const updatedRecipients = { ...recipients };
    updatedRecipients[type][index][field] = value;
    setRecipients(updatedRecipients);
  };

  const handleAddRecipient = (type) => {
    const newRecipient =
      type === "emails"
        ? { name: "", address: "", active: true, copy_type: "TO" }
        : { name: "", country_code: "44", number: "", active: true };
    setRecipients({
      ...recipients,
      [type]: [...recipients[type], newRecipient],
    });
  };

  const handleRemoveRecipient = (type, index) => {
    setRecipients({
      ...recipients,
      [type]: recipients[type].filter((_, i) => i !== index),
    });
  };

  const validateAndSave = () => {
    const newErrors = { emails: [], sms: [] };
    let isValid = true;

    recipients.emails.forEach((email, index) => {
      newErrors.emails[index] = {};
      if (!email.name.trim()) {
        newErrors.emails[index].name = "Name is required.";
        isValid = false;
      }
      if (!emailRegex.test(email.address)) {
        newErrors.emails[index].address = "Invalid email format.";
        isValid = false;
      }
    });

    recipients.sms.forEach((sms, index) => {
      newErrors.sms[index] = {};
      if (!sms.name.trim()) {
        newErrors.sms[index].name = "Name is required.";
        isValid = false;
      }
      if (!/^\d+$/.test(sms.number)) {
        newErrors.sms[index].number = "Must be numeric.";
        isValid = false;
      }
    });

    setErrors(newErrors);
    if (isValid) {
      onSave(recipients);
    }
  };

  return (
    <div className={styles.form}>
      <fieldset className={styles.fieldset}>
        <legend>Email Recipients</legend>
        {recipients.emails?.map((email, index) => (
          <div key={index} className={styles.recipientRow}>
            <input
              type="text"
              placeholder="Name"
              value={email.name}
              onChange={(e) => handleRecipientChange("emails", index, "name", e.target.value)}
              className={errors.emails[index]?.name ? styles.inputError : ""}
            />
            <input
              type="email"
              placeholder="Email Address"
              value={email.address}
              onChange={(e) => handleRecipientChange("emails", index, "address", e.target.value)}
              className={errors.emails[index]?.address ? styles.inputError : ""}
            />
            <select
              value={email.copy_type}
              onChange={(e) => handleRecipientChange("emails", index, "copy_type", e.target.value)}
            >
              <option value="TO">To</option>
              <option value="CC">Cc</option>
              <option value="BCC">Bcc</option>
            </select>
            <button onClick={() => handleRemoveRecipient("emails", index)} className={styles.removeButton}>×</button>
          </div>
        ))}
        <button type="button" onClick={() => handleAddRecipient("emails")} className="button button-secondary">+ Add Email</button>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>SMS Recipients</legend>
        {recipients.sms?.map((sms, index) => (
          <div key={index} className={styles.recipientRow}>
            <input
              type="text"
              placeholder="Name"
              value={sms.name}
              onChange={(e) => handleRecipientChange("sms", index, "name", e.target.value)}
               className={errors.sms[index]?.name ? styles.inputError : ""}
            />
            <select
              value={sms.country_code}
              onChange={(e) => handleRecipientChange("sms", index, "country_code", e.target.value)}
            >
              {countryCodes.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
            <input
              type="tel"
              placeholder="Phone Number (e.g. 7123456789)"
              value={sms.number}
              onChange={(e) => handleRecipientChange("sms", index, "number", e.target.value)}
               className={errors.sms[index]?.number ? styles.inputError : ""}
            />
            <button onClick={() => handleRemoveRecipient("sms", index)} className={styles.removeButton}>×</button>
          </div>
        ))}
        <button type="button" onClick={() => handleAddRecipient("sms")} className="button button-secondary">+ Add SMS</button>
      </fieldset>

      <div className={styles.actions}>
        <button type="button" onClick={onCancel} disabled={isSaving} className="button button-secondary">Cancel</button>
        <button type="button" onClick={validateAndSave} disabled={isSaving} className="button">
          {isSaving ? "Saving..." : "Save Recipients"}
        </button>
      </div>
    </div>
  );
}