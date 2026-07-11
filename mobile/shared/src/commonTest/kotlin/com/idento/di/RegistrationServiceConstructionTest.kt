package com.idento.di

import com.idento.data.network.ApiResult
import com.idento.data.registration.AttendeeLookup
import com.idento.data.registration.BatchCheckinSubmitter
import com.idento.data.registration.PrintJobEnqueuer
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationOfflineQueue
import com.idento.data.registration.RegistrationVerdictMapper
import kotlin.test.Test
import kotlin.test.assertNotNull

class RegistrationServiceConstructionTest {

    @Test
    fun verdictMapperConstructsWithFakeLookup() {
        val mapper = RegistrationVerdictMapper(
            attendeeLookup = AttendeeLookup { _, _ -> ApiResult.Error(Exception("fake")) },
        )
        assertNotNull(mapper)
    }

    @Test
    fun checkInServiceConstructsWithAllFourSeams() {
        val service = RegistrationCheckInService(
            batchSubmitter = BatchCheckinSubmitter { _, _ -> ApiResult.Error(Exception("fake")) },
            attendeeLookup = AttendeeLookup { _, _ -> ApiResult.Error(Exception("fake")) },
            offlineQueue = RegistrationOfflineQueue { _, _ -> },
            printJobEnqueuer = PrintJobEnqueuer { _, _ -> 0L },
        )
        assertNotNull(service)
    }
}
