package com.padhaikaro.app

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class PadhaiKaroWidgetModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "PadhaiKaroWidget"

  @ReactMethod
  fun updateSummary(todayMinutes: Int, pendingTopics: Int) {
    val context = reactApplicationContext
    context.getSharedPreferences("PadhaiKaroWidget", 0).edit()
      .putInt("todayMinutes", todayMinutes)
      .putInt("pendingTopics", pendingTopics)
      .apply()
    PadhaiKaroWidgetProvider.refreshAll(context)
  }
}
