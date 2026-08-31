package com.padhaikaro.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

public class PadhaiKaroWidgetProvider extends AppWidgetProvider {
  public static final String ACTION_REFRESH = "com.padhaikaro.app.WIDGET_REFRESH";

  @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
    for (int id : ids) update(context, manager, id);
  }

  @Override public void onReceive(Context context, Intent intent) {
    super.onReceive(context, intent);
    if (ACTION_REFRESH.equals(intent.getAction())) refreshAll(context);
  }

  public static void refreshAll(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    ComponentName component = new ComponentName(context, PadhaiKaroWidgetProvider.class);
    for (int id : manager.getAppWidgetIds(component)) update(context, manager, id);
  }

  private static void update(Context context, AppWidgetManager manager, int id) {
    SharedPreferences prefs = context.getSharedPreferences("PadhaiKaroWidget", Context.MODE_PRIVATE);
    int todayMinutes = prefs.getInt("todayMinutes", 0);
    int pendingTopics = prefs.getInt("pendingTopics", 0);
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_summary);
    views.setTextViewText(R.id.widget_title, "PadhaiKaro");
    views.setTextViewText(R.id.widget_minutes, todayMinutes + " min focused today");
    views.setTextViewText(R.id.widget_pending, pendingTopics + " topics pending");
    Intent launch = new Intent(context, MainActivity.class);
    launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
    manager.updateAppWidget(id, views);
  }
}
