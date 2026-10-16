package com.synergysign.app.di

import android.content.Context
import androidx.room.Room
import com.google.gson.Gson
import com.synergysign.app.data.api.ApiConfig
import com.synergysign.app.data.api.ApiService
import com.synergysign.app.data.api.AuthInterceptor
import com.synergysign.app.data.api.UnauthorizedInterceptor
import com.synergysign.app.data.local.*
import com.synergysign.app.data.repository.AuthRepository
import com.synergysign.app.data.repository.DocumentRepository
import com.synergysign.app.data.repository.OfflineRepository
import com.synergysign.app.data.repository.TokenRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideGson(): Gson = Gson()

    @Provides
    @Singleton
    fun provideTokenRepository(
        @ApplicationContext context: Context
    ): TokenRepository = TokenRepository(context)

    @Provides
    @Singleton
    fun provideAuthInterceptor(
        tokenRepository: TokenRepository
    ): AuthInterceptor = AuthInterceptor(tokenRepository)

    @Provides
    @Singleton
    fun provideUnauthorizedInterceptor(
        tokenRepository: TokenRepository,
        authInterceptor: AuthInterceptor
    ): UnauthorizedInterceptor = UnauthorizedInterceptor(tokenRepository, authInterceptor)

    @Provides
    @Singleton
    fun provideOkHttpClient(
        authInterceptor: AuthInterceptor,
        unauthorizedInterceptor: UnauthorizedInterceptor
    ): OkHttpClient {
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        return OkHttpClient.Builder()
            .addInterceptor(loggingInterceptor)
            .addInterceptor(authInterceptor)
            .addInterceptor(unauthorizedInterceptor)
            .connectTimeout(ApiConfig.CONNECT_TIMEOUT, TimeUnit.SECONDS)
            .readTimeout(ApiConfig.READ_TIMEOUT, TimeUnit.SECONDS)
            .writeTimeout(ApiConfig.WRITE_TIMEOUT, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(okHttpClient: OkHttpClient): Retrofit {
        return Retrofit.Builder()
            .baseUrl(ApiConfig.BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    @Provides
    @Singleton
    fun provideApiService(retrofit: Retrofit): ApiService {
        return retrofit.create(ApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideAuthRepository(
        apiService: ApiService,
        tokenRepository: TokenRepository
    ): AuthRepository = AuthRepository(apiService, tokenRepository)

    @Provides
    @Singleton
    fun provideDocumentRepository(
        apiService: ApiService
    ): DocumentRepository = DocumentRepository(apiService)

    // ==================== Room Database ====================

    @Provides
    @Singleton
    fun provideSynergySignDatabase(
        @ApplicationContext context: Context
    ): SynergySignDatabase {
        return Room.databaseBuilder(
            context,
            SynergySignDatabase::class.java,
            "synergysign_database"
        )
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    fun provideDocumentDao(database: SynergySignDatabase): DocumentDao {
        return database.documentDao()
    }

    @Provides
    fun provideSignerDao(database: SynergySignDatabase): SignerDao {
        return database.signerDao()
    }

    @Provides
    fun provideFieldDao(database: SynergySignDatabase): FieldDao {
        return database.fieldDao()
    }

    @Provides
    fun providePendingActionDao(database: SynergySignDatabase): PendingActionDao {
        return database.pendingActionDao()
    }

    @Provides
    fun provideCachedPdfDao(database: SynergySignDatabase): CachedPdfDao {
        return database.cachedPdfDao()
    }

    @Provides
    @Singleton
    fun provideOfflineRepository(
        documentDao: DocumentDao,
        signerDao: SignerDao,
        fieldDao: FieldDao,
        pendingActionDao: PendingActionDao,
        cachedPdfDao: CachedPdfDao
    ): OfflineRepository = OfflineRepository(
        documentDao,
        signerDao,
        fieldDao,
        pendingActionDao,
        cachedPdfDao
    )
}
