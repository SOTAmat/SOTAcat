#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <mutex>  // for convenience when using std::lock_guard

class Lockable {
    SemaphoreHandle_t m_mutex;
    char const *      m_name;

  public:
    explicit Lockable (char const * name);
    ~Lockable();

    // Disable all copying and moving
    Lockable (const Lockable &)             = delete;
    Lockable & operator= (const Lockable &) = delete;
    Lockable (Lockable &&)                  = delete;
    Lockable & operator= (Lockable &&)      = delete;

    void lock ();
    void unlock ();

    // Check if mutex is held by current task
    bool locked () const {
        return m_mutex != nullptr && xSemaphoreGetMutexHolder (m_mutex) == xTaskGetCurrentTaskHandle();
    }

    // Expose mutex for timeout-based locking
    SemaphoreHandle_t get_mutex () const { return m_mutex; }
};
