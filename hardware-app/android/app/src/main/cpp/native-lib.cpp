// Entry Android Hardware — nodejs-mobile 시작 (nodejs-mobile 안드로이드 예제와 같은 방식)
// Node 는 한 프로세스에서 한 번만 시작할 수 있다. node::Start 는 Node 가 끝날 때까지 돌아오지 않는다.
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "node.h"

static const char *TAG = "EntryHwNode";
static int pipe_stdout[2];
static int pipe_stderr[2];
static pthread_t thread_stdout;
static pthread_t thread_stderr;

static void *log_pipe(void *arg) {
    int fd = *static_cast<int *>(arg);
    int prio = (fd == pipe_stderr[0]) ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO;
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof buf - 1)) > 0) {
        if (buf[n - 1] == '\n') {
            --n;
        }
        buf[n] = 0;
        __android_log_write(prio, TAG, buf);
    }
    return nullptr;
}

// console.log 등을 logcat 으로 (adb logcat -s EntryHwNode)
static void redirect_stdout_stderr() {
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pipe_stdout) == 0) {
        dup2(pipe_stdout[1], STDOUT_FILENO);
        pthread_create(&thread_stdout, nullptr, log_pipe, &pipe_stdout[0]);
        pthread_detach(thread_stdout);
    }
    if (pipe(pipe_stderr) == 0) {
        dup2(pipe_stderr[1], STDERR_FILENO);
        pthread_create(&thread_stderr, nullptr, log_pipe, &pipe_stderr[0]);
        pthread_detach(thread_stderr);
    }
}

extern "C" JNIEXPORT jint JNICALL
Java_biz_softline_entryhw_NodeRunner_startNodeWithArguments(JNIEnv *env, jclass /* clazz */, jobjectArray arguments) {
    redirect_stdout_stderr();

    jsize argc = env->GetArrayLength(arguments);
    // node 는 argv 가 한 덩어리의 연속된 메모리에 있다고 가정한다
    std::vector<std::string> args;
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        auto jstr = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *c = env->GetStringUTFChars(jstr, nullptr);
        args.emplace_back(c);
        total += args.back().size() + 1;
        env->ReleaseStringUTFChars(jstr, c);
        env->DeleteLocalRef(jstr);
    }
    char *buffer = static_cast<char *>(calloc(total, sizeof(char)));
    std::vector<char *> argv(argc);
    char *pos = buffer;
    for (jsize i = 0; i < argc; i++) {
        memcpy(pos, args[i].c_str(), args[i].size());
        argv[i] = pos;
        pos += args[i].size() + 1;
    }
    return jint(node::Start(argc, argv.data()));
}
