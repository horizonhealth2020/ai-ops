'use strict';

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_INDEX_MAP = { 0: 'monday', 1: 'tuesday', 2: 'wednesday', 3: 'thursday', 4: 'friday', 5: 'saturday', 6: 'sunday' };

/**
 * Get the current time parts in a given timezone.
 * @param {string} timezone - IANA timezone string
 * @returns {{ dayOfWeek: number, dayName: string, hour: number, minute: number }}
 */
function getCurrentTimeParts(timezone) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'America/New_York',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const dayName = parts.find(p => p.type === 'weekday')?.value?.toLowerCase();
  let hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  if (hour === 24) hour = 0;

  const dayOfWeek = DAY_NAMES.indexOf(dayName);

  return { dayOfWeek, dayName, hour, minute };
}

/**
 * Check if the current time falls within business hours for a given client.
 * @param {Array} businessHoursRows - rows from business_hours table
 * @param {string} timezone - client timezone
 * @returns {{ isOpen: boolean, currentDay: string, currentTime: string }}
 */
function checkBusinessHours(businessHoursRows, timezone) {
  const { dayOfWeek, dayName, hour, minute } = getCurrentTimeParts(timezone);
  const currentTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  if (!businessHoursRows || businessHoursRows.length === 0) {
    return { isOpen: true, currentDay: dayName, currentTime };
  }

  const todayRow = businessHoursRows.find(r => r.day_of_week === dayOfWeek);
  if (!todayRow || !todayRow.is_open) {
    return { isOpen: false, currentDay: dayName, currentTime };
  }

  const openStr = todayRow.open_time?.substring(0, 5);
  const closeStr = todayRow.close_time?.substring(0, 5);
  if (!openStr || !closeStr) {
    return { isOpen: true, currentDay: dayName, currentTime };
  }

  const isOpen = currentTime >= openStr && currentTime < closeStr;
  return { isOpen, currentDay: dayName, currentTime };
}

/**
 * Format current date/time as a string for prompt injection.
 */
function formatCurrentDateTime(timezone) {
  const now = new Date();
  return now.toLocaleString('en-US', {
    timeZone: timezone || 'America/New_York',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

module.exports = { getCurrentTimeParts, checkBusinessHours, formatCurrentDateTime, DAY_NAMES, DAY_INDEX_MAP };
