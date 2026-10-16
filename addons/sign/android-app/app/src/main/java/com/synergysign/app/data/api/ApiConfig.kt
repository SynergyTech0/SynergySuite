package com.synergysign.app.data.api

/**
 * API Configuration
 * Update BASE_URL with your server address
 */
object ApiConfig {
    // For Android Emulator accessing localhost
    const val BASE_URL = "http://10.0.2.2:3000/api/"
    
    // For physical device on same network
    // const val BASE_URL = "http://192.168.1.x:3000/api/"
    
    // For production
    // const val BASE_URL = "https://your-synergysign-domain.com/api/"
    
    const val CONNECT_TIMEOUT = 30L
    const val READ_TIMEOUT = 30L
    const val WRITE_TIMEOUT = 30L
}
