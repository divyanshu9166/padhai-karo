import * as Notifications from 'expo-notifications';

export async function scheduleFocusBreakReminder(): Promise<string> {
    return Notifications.scheduleNotificationAsync({
        content: { title: 'Take a short break', body: 'Stand up, drink water and return gently to the next block.', sound: 'default' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 25 * 60, repeats: false, channelId: 'study-reminders' },
    });
}

export async function scheduleRevisionReminder(date: Date, dueCount: number): Promise<string> {
    return Notifications.scheduleNotificationAsync({
        content: { title: 'Revision cards are due', body: dueCount + ' active-recall card' + (dueCount === 1 ? '' : 's') + ' waiting in PadhaiKaro.', sound: 'default' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: 'study-reminders' },
    });
}

export async function scheduleExamChecklistReminder(date: Date, label: string): Promise<string> {
    const reminderDate = new Date(date);
    if (reminderDate.getTime() <= Date.now()) return Promise.resolve('');
    return Notifications.scheduleNotificationAsync({
        content: { title: 'Exam checklist reminder', body: label + ' is due before your exam.', sound: 'default' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminderDate, channelId: 'study-reminders' },
    });
}
