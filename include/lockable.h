#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <mutex>  // for convenience when using std::lock_guard

class Lockable {
    bool              m_locked;
    SemaphoreHandle_t m_mutex;
    char const *      m_name;

  public:
    Lockable (char const * name);
    void lock ();
    void unlock ();

    bool locked () const { return m_locked; }
};
